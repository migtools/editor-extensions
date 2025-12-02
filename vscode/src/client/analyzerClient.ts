import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import path from "node:path";
import * as fs from "fs-extra";
import * as vscode from "vscode";
import * as rpc from "vscode-jsonrpc/node";
import {
  ExtensionData,
  RuleSet,
  ServerState,
  SolutionState,
  Violation,
} from "@editor-extensions/shared";
import { paths, ignoresToExcludedPaths } from "../paths";
import { normalizeFilePath } from "../utilities/pathUtils";
import { Extension } from "../helpers/Extension";
import { buildAssetPaths, AssetPaths } from "./paths";
import { getConfigAnalyzerPath, getConfigKaiDemoMode, isAnalysisResponse } from "../utilities";
import { allIncidents } from "../issueView";
import { Immutable } from "immer";
import { countIncidentsOnPaths } from "../analysis";
import { createConnection, Socket } from "node:net";
import { FileChange } from "./types";
import { TaskManager } from "src/taskManager/types";
import { Logger } from "winston";
import { executeExtensionCommand } from "../commands";

const uid = (() => {
  let counter = 0;
  return (prefix: string = "") => `${prefix}${counter++}`;
})();

export class WorksapceCommandParams {
  public command: string | undefined;
  public arguments: any[] | undefined;
}

export class AnalyzerClient {
  private assetPaths: AssetPaths;
  private analyzerRpcServer: ChildProcessWithoutNullStreams | null = null;
  private analyzerRpcConnection?: rpc.MessageConnection | null;

  constructor(
    private extContext: vscode.ExtensionContext,
    private mutateExtensionData: (recipe: (draft: ExtensionData) => void) => void,
    private getExtStateData: () => Immutable<ExtensionData>,
    private readonly taskManager: TaskManager,
    private readonly logger: Logger,
  ) {
    this.assetPaths = buildAssetPaths(extContext);
    this.taskManager = taskManager;
    this.logger = logger.child({
      component: "AnalyzerClient",
    });
    // TODO: Push the serverState from "initial" to either "configurationNeeded" or "configurationReady"
  }

  private fireServerStateChange(state: ServerState) {
    this.mutateExtensionData((draft) => {
      this.logger.info(`serverState change from [${draft.serverState}] to [${state}]`);
      draft.serverState = state;
      draft.isStartingServer = state === "starting";
      draft.isInitializingServer = state === "initializing";
    });
  }

  private fireAnalysisStateChange(flag: boolean) {
    this.mutateExtensionData((draft) => {
      draft.isAnalyzing = flag;
    });
  }

  public get serverState(): ServerState {
    return this.getExtStateData().serverState;
  }

  public get analysisState(): boolean {
    return this.getExtStateData().isAnalyzing;
  }

  public get solutionState(): SolutionState {
    return this.getExtStateData().solutionState;
  }

  /**
   * Start the `kai-rpc-server`, wait until it is ready, and then setup the rpcConnection.
   *
   * Will only run if the sever state is: `stopped`, `configurationReady`
   *
   * Server state changes:
   *   - `starting`
   *   - `startFailed`
   *   - `stopped`: When the process exits (clean shutdown, aborted, killed, ...) the server
   *                states changes to `stopped` via the process event `exit`
   *
   * @throws Error if the process cannot be started
   */
  public async start(): Promise<void> {
    // TODO: Ensure serverState is stopped || configurationReady

    if (!this.canAnalyze()) {
      vscode.window.showErrorMessage(
        "Cannot start the kai rpc server due to missing configuration.",
      );
      return;
    }

    this.logger.info("Starting kai analyzer rpc");
    this.fireServerStateChange("starting");
    const startTime = performance.now();

    const pipeName = rpc.generateRandomPipeName();
    const [analyzerRpcServer, analyzerPid] = this.startAnalysisServer(pipeName);
    analyzerRpcServer.on("exit", (code, signal) => {
      const exitReason = signal ? `signal: ${signal}` : `exit code: ${code}`;
      this.logger.info(`Analyzer RPC server terminated [${exitReason}]`, {
        code,
        signal,
        currentState: this.getExtStateData().serverState,
        wasExpected: this.getExtStateData().serverState === "stopping",
      });

      if (code && code !== 0) {
        const message = `Analyzer RPC server failed with exit code ${code}. Check the analyzer.log for details.`;
        this.logger.error(message);
        vscode.window.showErrorMessage(message);
      } else if (signal && this.getExtStateData().serverState !== "stopping") {
        this.logger.warn(`Analyzer was terminated unexpectedly by signal: ${signal}`);
      }

      this.fireServerStateChange("stopped");
      this.analyzerRpcServer = null;
    });
    analyzerRpcServer.on("close", (code, signal) => {
      this.logger.info(`Analyzer RPC server closed [signal: ${signal}, code: ${code}]`);
      this.fireServerStateChange("stopped");
      this.analyzerRpcServer = null;
    });
    analyzerRpcServer.on("error", (err) => {
      this.logger.error("Analyzer RPC server error", err);
      this.fireServerStateChange("startFailed");
      this.analyzerRpcServer = null;
      vscode.window.showErrorMessage(
        `Analyzer RPC server failed - ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    this.analyzerRpcServer = analyzerRpcServer;
    this.logger.info(`Analyzer RPC server started successfully [pid: ${analyzerPid}]`);

    let socket: Socket;
    try {
      socket = await this.getSocket(pipeName);
    } catch (err) {
      const processStillRunning =
        this.analyzerRpcServer &&
        !this.analyzerRpcServer.killed &&
        this.analyzerRpcServer.exitCode === null;

      this.logger.error(`Failed to establish socket connection to pipe '${pipeName}'`, {
        error: err instanceof Error ? err.message : String(err),
        serverPid: analyzerPid,
        serverRunning: this.analyzerRpcServer !== null,
        serverKilled: this.analyzerRpcServer?.killed,
        serverExitCode: this.analyzerRpcServer?.exitCode,
        processStillAlive: processStillRunning,
        suggestion: processStillRunning
          ? "Process is running but not responding on the named pipe. Check analyzer.log for errors."
          : "Process has exited. Check if it crashed during startup.",
      });

      // Try to read the analyzer log file for more context
      const logs = path.join(paths().serverLogs.fsPath, "analyzer.log");
      try {
        if (await fs.pathExists(logs)) {
          const logContent = await fs.readFile(logs, "utf-8");
          const lines = logContent.split("\n").filter((l) => l.trim());
          this.logger.error("Analyzer log content (last 20 lines):", {
            lines: lines.slice(-20),
          });
        }
      } catch (logError) {
        this.logger.warn("Could not read analyzer log file");
      }

      throw err;
    }

    socket.addListener("connectionAttempt", () => {
      this.logger.info("Attempting to establish connection...");
    });
    socket.addListener("connectionAttemptFailed", () => {
      this.logger.warn("Connection attempt failed");
    });
    socket.on("data", (data) => {
      this.logger.debug(
        `Received socket data (${data.length} bytes): ${data.toString().substring(0, 200)}`,
      );
    });

    this.logger.info("Creating RPC message reader and writer");
    const reader = new rpc.SocketMessageReader(socket, "utf-8");
    const writer = new rpc.SocketMessageWriter(socket, "utf-8");
    this.logger.info("RPC message reader and writer created");

    reader.onClose(() => {
      this.logger.info("Message reader closed");
    });
    reader.onError((e) => {
      this.logger.error("Error in message reader", e);
    });
    writer.onClose(() => {
      this.logger.info("Message writer closed");
    });
    writer.onError((e) => {
      this.logger.error("Error in message writer", e);
    });

    this.logger.info("Creating RPC message connection");
    this.analyzerRpcConnection = rpc.createMessageConnection(reader, writer);
    this.logger.info("RPC message connection created");

    this.analyzerRpcConnection.trace(
      rpc.Trace.Messages,
      {
        log: (message) => {
          this.logger.debug("RPC Trace", { message: JSON.stringify(message).substring(0, 500) });
        },
      },
      false,
    );
    this.analyzerRpcConnection.onUnhandledNotification((e) => {
      this.logger.warn(`Unhandled notification: ${e.method}`);
    });

    this.analyzerRpcConnection.onClose(() => {
      this.logger.info("RPC connection closed");
      this.logger.debug("RPC connection closed, current server state:", {
        state: this.getExtStateData().serverState,
      });
    });

    this.analyzerRpcConnection.onRequest((method, params) => {
      this.logger.debug(`Received request: ${method}`, {
        params: JSON.stringify(params).substring(0, 200),
      });
    });

    this.analyzerRpcConnection.onNotification("started", (_: []) => {
      this.logger.info("✓ Server 'started' notification received");
      this.fireServerStateChange("running");
    });
    this.analyzerRpcConnection.onNotification((method: string, params: any) => {
      this.logger.debug(`Received notification: ${method} + ${JSON.stringify(params)}`);
    });
    this.analyzerRpcConnection.onUnhandledNotification((e) => {
      this.logger.warn(`Unhandled notification: ${e.method}`);
    });
    this.analyzerRpcConnection.onRequest(
      "workspace/executeCommand",
      async (params: WorksapceCommandParams) => {
        this.logger.debug(`Executing workspace command`, {
          command: params.command,
          arguments: JSON.stringify(params.arguments),
        });

        try {
          const result = await vscode.commands.executeCommand(
            "java.execute.workspaceCommand",
            params.command,
            params.arguments![0],
          );

          this.logger.debug(`Command execution result: ${JSON.stringify(result)}`);
          return result;
        } catch (error) {
          this.logger.error(`[Java] Command execution error`, error);
        }
      },
    );
    this.analyzerRpcConnection.onError((e) => {
      const currentState = this.getExtStateData().serverState;
      this.logger.error("RPC connection error", {
        error: e,
        errorType: e.constructor.name,
        currentState,
        serverPid: this.analyzerRpcServer?.pid,
        serverKilled: this.analyzerRpcServer?.killed,
      });

      // If we're still in starting/initializing state, this means connection failed
      if (currentState === "starting" || currentState === "initializing") {
        this.logger.error("RPC connection failed during startup, cleaning up...");
        this.fireServerStateChange("startFailed");
        // Kill the analyzer process since we can't communicate with it
        if (this.analyzerRpcServer && !this.analyzerRpcServer.killed) {
          this.logger.info(`Killing analyzer process ${this.analyzerRpcServer.pid}`);
          this.analyzerRpcServer.kill();
        }
        vscode.window.showErrorMessage(
          "Failed to establish connection with analyzer server. Please try starting the server again.",
        );
      }
    });

    this.logger.info("Starting RPC connection listener");
    this.analyzerRpcConnection.listen();
    this.logger.info("RPC connection listener started");

    this.logger.info("Sending 'start' notification to analyzer server");
    this.analyzerRpcConnection.sendNotification("start", { type: "start" });
    this.logger.info("'start' notification sent, waiting for server response");

    // Give the server a moment to respond and write to its log
    await setTimeout(1000);

    // Check analyzer log file for additional info
    const logs = path.join(paths().serverLogs.fsPath, "analyzer.log");
    try {
      if (await fs.pathExists(logs)) {
        const logContent = await fs.readFile(logs, "utf-8");
        const lastLines = logContent.split("\n").slice(-10).join("\n");
        if (lastLines.trim()) {
          this.logger.debug("Recent analyzer.log content:", {
            lines: lastLines.trim(),
          });
        } else {
          this.logger.warn("analyzer.log exists but is empty");
        }
      } else {
        this.logger.warn(`analyzer.log not found at: ${logs}`);
      }
    } catch (error) {
      this.logger.warn(
        `Could not read analyzer.log: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await this.runHealthCheck();
    this.logger.info(`startAnalyzer took ${performance.now() - startTime}ms`);
  }

  protected async runHealthCheck(): Promise<void> {
    if (!this.analyzerRpcConnection) {
      this.logger.warn("Analyzer RPC connection is not established");
      return;
    }
    try {
      const healthcheckResult = await vscode.commands.executeCommand(
        "java.execute.workspaceCommand",
        "java.project.getAll",
      );
      this.logger.info(
        `Java Language Server Healthcheck result: ${JSON.stringify(healthcheckResult)}`,
      );
      if (
        healthcheckResult === undefined ||
        !Array.isArray(healthcheckResult) ||
        healthcheckResult.length < 1
      ) {
        vscode.window.showErrorMessage(
          "It appears that the Java Language Server is not running or the project configuration is not set up correctly. Analysis results may be degraded.",
        );
      }
    } catch (error) {
      this.logger.error("Error running Java Language Server healthcheck", error);
    }
  }

  protected async getSocket(pipeName: string): Promise<Socket> {
    this.logger.info(`Attempting to connect to pipe: ${pipeName}`);
    const s = createConnection(pipeName);
    let ready = false;
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 2000; // 2 seconds
    let retryCount = 0;
    let lastError: Error | undefined;

    s.on("ready", () => {
      this.logger.info("Socket connection ready");
      ready = true;
    });

    s.on("error", (err) => {
      lastError = err;
      const errorCode = (err as any).code;
      const isTimeout = errorCode === "ETIMEDOUT";
      const isNoEnt = errorCode === "ENOENT";

      this.logger.error(`Socket connection error: ${err.message}`, {
        code: errorCode,
        errno: (err as any).errno,
        syscall: (err as any).syscall,
        address: (err as any).address,
        interpretation: isTimeout
          ? "Server stopped responding after initial connection"
          : isNoEnt
            ? "Named pipe does not exist yet (server not ready)"
            : "Unknown error type",
      });
    });

    s.on("connect", () => {
      this.logger.info("Socket connected successfully");
    });

    s.on("close", (hadError) => {
      this.logger.warn(`Socket closed ${hadError ? "with error" : "cleanly"}`);
    });

    while ((s.connecting || !s.readable) && !ready && retryCount < MAX_RETRIES) {
      this.logger.info(`Connection attempt ${retryCount + 1}/${MAX_RETRIES}`, {
        socketState: {
          connecting: s.connecting,
          readable: s.readable,
          writable: s.writable,
          ready,
          destroyed: s.destroyed,
          pending: s.pending,
        },
      });
      await setTimeout(RETRY_DELAY);
      retryCount++;

      if (!s.connecting && s.readable) {
        this.logger.info("Socket is now readable, breaking retry loop");
        break;
      }
      if (!s.connecting) {
        this.logger.info(`Retrying connection to pipe: ${pipeName}`);
        s.connect(pipeName);
      }
    }

    if (s.readable) {
      this.logger.info(`Successfully connected to pipe after ${retryCount} attempt(s)`, {
        socketState: {
          connecting: s.connecting,
          readable: s.readable,
          writable: s.writable,
          destroyed: s.destroyed,
          pending: s.pending,
        },
      });
      return s;
    } else {
      const errorDetails = lastError
        ? ` Last error: ${lastError.message} (${(lastError as any).code || "unknown code"})`
        : "";
      const errorMessage = `Unable to connect to pipe '${pipeName}' after ${MAX_RETRIES} retries.${errorDetails} Please check that the analyzer server started correctly and Java environment is configured properly.`;
      this.logger.error(errorMessage, {
        pipeName,
        retries: retryCount,
        lastError: lastError?.message,
        errorCode: (lastError as any)?.code,
      });
      throw Error(errorMessage);
    }
  }

  protected startAnalysisServer(
    pipeName: string,
  ): [ChildProcessWithoutNullStreams, number | undefined] {
    const analyzerPath = this.getAnalyzerPath();
    const serverEnv = this.getKaiRpcServerEnv();
    const analyzerLspRulesPaths = this.getRulesetsPath().join(",");
    const location = paths().workspaceRepo.fsPath;
    const logs = path.join(paths().serverLogs.fsPath, "analyzer.log");

    const args = [
      "-pipePath",
      pipeName,
      "-rules",
      analyzerLspRulesPaths,
      "-source-directory",
      location,
      "-log-file",
      logs,
    ];

    this.logger.info(`Starting analyzer server with configuration:`, {
      cwd: paths().serverCwd.fsPath,
      analyzerPath,
      pipeName,
      rulesPath: analyzerLspRulesPaths,
      sourceDirectory: location,
      logFile: logs,
    });
    this.logger.debug(`Full command: ${analyzerPath} ${args.join(" ")}`);

    const analyzerRpcServer = spawn(analyzerPath, args, {
      cwd: paths().serverCwd.fsPath,
      env: serverEnv,
      windowsHide: true, // Hide console window on Windows
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";

    analyzerRpcServer.stdout.on("data", (data) => {
      const asString: string = data.toString();
      stdoutBuffer += asString;

      // Log line by line for better readability
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || ""; // Keep incomplete line in buffer

      lines.forEach((line) => {
        if (line.trim()) {
          this.logger.info(`[analyzer stdout] ${line}`);
        }
      });
    });

    analyzerRpcServer.stderr.on("data", (data) => {
      const asString: string = data.toString();
      stderrBuffer += asString;

      // Log line by line for better readability
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || ""; // Keep incomplete line in buffer

      lines.forEach((line) => {
        if (line.trim()) {
          this.logger.error(`[analyzer stderr] ${line}`);
        }
      });
    });

    // Log any remaining buffered output when streams close
    analyzerRpcServer.stdout.on("end", () => {
      if (stdoutBuffer.trim()) {
        this.logger.info(`[analyzer stdout] ${stdoutBuffer.trim()}`);
      }
      this.logger.debug("Analyzer stdout stream ended");
    });

    analyzerRpcServer.stderr.on("end", () => {
      if (stderrBuffer.trim()) {
        this.logger.error(`[analyzer stderr] ${stderrBuffer.trim()}`);
      }
      this.logger.debug("Analyzer stderr stream ended");
    });

    if (!analyzerRpcServer.pid) {
      this.logger.error("Failed to start analyzer server - no PID assigned");
    } else {
      this.logger.info(`Analyzer server process spawned with PID: ${analyzerRpcServer.pid}`);
    }

    return [analyzerRpcServer, analyzerRpcServer.pid];
  }

  protected isDemoMode(): boolean {
    const configDemoMode = getConfigKaiDemoMode();

    return configDemoMode !== undefined
      ? configDemoMode
      : !Extension.getInstance(this.extContext).isProductionMode;
  }

  /**
   * Shutdown and, if necessary, hard stops the server.
   *
   * Will run from any server state, and any running server process will be killed.
   *
   * Server state change: `stopping`
   */
  public async stop(): Promise<void> {
    this.logger.info(`Stopping the analyzer rpc server...`);
    this.fireServerStateChange("stopping");

    // First close the RPC connection if it exists
    if (this.analyzerRpcConnection) {
      this.logger.info(`Closing analyzer rpc connection...`);
      this.analyzerRpcConnection.end();
      this.analyzerRpcConnection.dispose();
      this.analyzerRpcConnection = null;
    }

    // Then stop the server process if it exists
    if (this.analyzerRpcServer) {
      if (this.analyzerRpcServer.exitCode === null) {
        this.analyzerRpcServer.kill();
      }
      this.analyzerRpcServer = null;
    }

    this.logger.info(`analyzer rpc server stopped`);
  }

  public isServerRunning(): boolean {
    return !!this.analyzerRpcServer && !this.analyzerRpcServer.killed;
  }

  public async notifyFileChanges(fileChanges: FileChange[]): Promise<void> {
    if (this.serverState !== "running" || !this.analyzerRpcConnection) {
      this.logger.warn("kai rpc server is not running, skipping notifyFileChanged.");
      return;
    }
    const changes = fileChanges.map((change) => ({
      path: change.path.fsPath,
      content: change.content,
      saved: change.saved,
    }));
    if (changes.length > 0) {
      await this.analyzerRpcConnection!.sendRequest("analysis_engine.NotifyFileChanges", {
        changes: changes,
      });
    }
  }

  /**
   * Request the server to __Analyze__
   *
   * Will only run if the sever state is: `running`
   */
  public async runAnalysis(filePaths?: vscode.Uri[]): Promise<void> {
    if (this.serverState !== "running" || !this.analyzerRpcConnection) {
      this.logger.warn("kai rpc server is not running, skipping runAnalysis.");
      return;
    }
    this.logger.info("Running analysis");
    const analysisStartTime = performance.now();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Running Analysis",
        cancellable: true,
      },
      async (progress, token) => {
        try {
          progress.report({ message: "Running..." });
          this.fireAnalysisStateChange(true);
          const activeProfile = this.getExtStateData().profiles.find(
            (p) => p.id === this.getExtStateData().activeProfileId,
          );
          if (!activeProfile) {
            this.logger.warn("No active profile found.");
            vscode.window.showErrorMessage("No active profile found.");
            this.fireAnalysisStateChange(false);
            return;
          }
          if (!activeProfile.labelSelector) {
            this.logger.warn("LabelSelector is not configured.");
            vscode.window.showErrorMessage("LabelSelector is not configured.");
            this.fireAnalysisStateChange(false);
            return;
          }

          const requestParams = {
            label_selector: activeProfile.labelSelector,
            included_paths: filePaths?.map((uri) => normalizeFilePath(uri.fsPath)),
            reset_cache: !(filePaths && filePaths.length > 0),
            excluded_paths: ignoresToExcludedPaths().flatMap((path) => [
              path,
              normalizeFilePath(path),
            ]),
          };
          this.logger.info(
            `Sending 'analysis_engine.Analyze' request with params: ${JSON.stringify(
              requestParams,
            )}`,
          );

          if (token.isCancellationRequested) {
            this.logger.warn("Analysis was canceled by the user.");
            this.fireAnalysisStateChange(false);
            return;
          }

          const cancellationPromise = new Promise((resolve) => {
            token.onCancellationRequested(() => {
              resolve({ isCancelled: true });
            });
          });

          const { response: rawResponse, isCancelled }: any = await Promise.race([
            this.analyzerRpcConnection!.sendRequest("analysis_engine.Analyze", requestParams).then(
              (response) => ({ response }),
            ),
            cancellationPromise,
          ]);

          if (isCancelled) {
            this.logger.warn("Analysis operation was canceled.");
            vscode.window.showInformationMessage("Analysis was canceled.");
            this.fireAnalysisStateChange(false);
            return;
          }
          const isResponseWellFormed = isAnalysisResponse(rawResponse?.Rulesets);
          const ruleSets: RuleSet[] = isResponseWellFormed ? rawResponse?.Rulesets : [];
          const summary = isResponseWellFormed
            ? {
                wellFormed: true,
                rawIncidentCount: ruleSets
                  .flatMap((r) => Object.values<Violation>(r.violations ?? {}))
                  .flatMap((v) => v.incidents ?? []).length,
                incidentCount: allIncidents(ruleSets).length,
                partialAnalysis: filePaths
                  ? {
                      incidentsBefore: countIncidentsOnPaths(
                        this.getExtStateData().ruleSets,
                        filePaths.map((uri) => uri.toString()),
                      ),
                      incidentsAfter: countIncidentsOnPaths(
                        ruleSets,
                        filePaths.map((uri) => uri.toString()),
                      ),
                    }
                  : {},
              }
            : { wellFormed: false };

          this.logger.info(`Response received. Summary: ${JSON.stringify(summary)}`);

          // Handle the result
          if (!isResponseWellFormed) {
            vscode.window.showErrorMessage(
              "Analysis completed, but received results are not well formed.",
            );
            this.fireAnalysisStateChange(false);
            return;
          }
          if (ruleSets.length === 0) {
            vscode.window.showInformationMessage("Analysis completed. No incidents were found.");
          }

          // Add active profile name to each RuleSet
          const currentProfile = this.getExtStateData().profiles.find(
            (p) => p.id === this.getExtStateData().activeProfileId,
          );
          if (currentProfile) {
            ruleSets.forEach((ruleSet) => {
              (ruleSet as any).activeProfileName = currentProfile.name;
            });
          }

          await executeExtensionCommand("loadRuleSets", ruleSets);
          this.taskManager.init();
          progress.report({ message: "Results processed!" });
          vscode.window.showInformationMessage("Analysis completed successfully!");
        } catch (err: any) {
          this.logger.error("Error during analysis", err);
          vscode.window.showErrorMessage("Analysis failed. See the output channel for details.");
        }
        this.fireAnalysisStateChange(false);
      },
    );
    this.logger.info(`runAnalysis took ${performance.now() - analysisStartTime}ms`);
  }

  public canAnalyze(): boolean {
    const { activeProfileId, profiles } = this.getExtStateData();
    const profile = profiles.find((p) => p.id === activeProfileId);
    return (
      !!profile?.labelSelector && (profile?.useDefaultRules || profile?.customRules.length > 0)
    );
  }

  public async canAnalyzeInteractive(): Promise<boolean> {
    let config;
    try {
      config = this.getActiveProfileConfig();
    } catch {
      vscode.window.showErrorMessage("No active analysis profile is configured.");
      return false;
    }

    if (!config.labelSelector) {
      const selection = await vscode.window.showErrorMessage(
        "Label selector is missing from the active profile. Please configure it before starting the analyzer.",
        "Manage Profiles",
        "Cancel",
      );

      if (selection === "Manage Profiles") {
        await executeExtensionCommand("openProfilesPanel");
      }

      return false;
    }

    if (config.rulesets.length === 0) {
      const selection = await vscode.window.showWarningMessage(
        "No rules are defined in the active profile. Enable default rules or provide custom rules.",
        "Manage Profiles",
        "Cancel",
      );

      if (selection === "Manage Profiles") {
        await executeExtensionCommand("openProfilesPanel");
      }

      return false;
    }

    return true;
  }

  protected getAnalyzerPath(): string {
    const path = getConfigAnalyzerPath() || this.assetPaths.kaiAnalyzer;

    if (!fs.existsSync(path)) {
      const message = `Analyzer binary doesn't exist at ${path}`;
      this.logger.error(message);
      vscode.window.showErrorMessage(message);
    }

    return path;
  }

  /**
   * Build the process environment variables to be setup for the kai rpc server process.
   */
  protected getKaiRpcServerEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
    };
  }

  protected getRulesetsPath(): string[] {
    return this.getActiveProfileConfig().rulesets;
  }

  protected getActiveProfileConfig() {
    const { activeProfileId, profiles } = this.getExtStateData();
    const profile = profiles.find((p) => p.id === activeProfileId);
    if (!profile) {
      throw new Error("No active profile configured.");
    }

    const rulesets: string[] = [
      profile.useDefaultRules ? this.assetPaths.rulesets : null,
      ...(profile.customRules || []),
    ].filter(Boolean) as string[];

    return {
      labelSelector: profile.labelSelector,
      rulesets,
      isValid: !!profile.labelSelector && rulesets.length > 0,
    };
  }
}
