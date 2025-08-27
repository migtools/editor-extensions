import "./receivedMessage.css";
import React, { useState } from "react";
import { Message } from "@patternfly/chatbot";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import konveyorAvatar from "./avatarIcons/konveyor_avatar.svg?inline";
import mtaRedAvatar from "./avatarIcons/mta_red.svg?inline";
import { QuickResponse } from "../../../../shared/src/types/types";
import { getBrandName, isMTA } from "../../utils/branding";

interface QuickResponseWithToken extends QuickResponse {
  messageToken: string;
}

interface ReceivedMessageProps {
  content?: string;
  extraContent?: React.ReactNode;
  isLoading?: boolean;
  timestamp?: string | Date;
  quickResponses?: QuickResponseWithToken[];
  isProcessing?: boolean;
}

export const ReceivedMessage: React.FC<ReceivedMessageProps> = ({
  content,
  extraContent,
  isLoading: _isLoading,
  timestamp = new Date(),
  quickResponses,
  isProcessing = false,
}) => {
  // Don't render anything if there's no content and no extra content
  // This prevents "phantom" blank messages from appearing
  if (!content && !extraContent && !quickResponses?.length) {
    return null;
  }
  const [selectedResponse, setSelectedResponse] = useState<string | null>(null);
  const formatTimestamp = (time: string | Date): string => {
    const date = typeof time === "string" ? new Date(time) : time;
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const handleQuickResponse = (responseId: string, messageToken: string) => {
    // Update state to reflect selected response
    // Note: Consider using React.memo or other optimization techniques if flickering persists
    setSelectedResponse(responseId);
    window.vscode.postMessage({
      type: "QUICK_RESPONSE",
      payload: {
        responseId,
        messageToken,
      },
    });
  };

  // Select avatar based on brand
  const selectedAvatar = isMTA() ? mtaRedAvatar : konveyorAvatar;

  return (
    <Message
      timestamp={formatTimestamp(timestamp)}
      name={getBrandName()}
      role="bot"
      avatar={selectedAvatar}
      content={content}
      quickResponses={quickResponses?.map((response) => ({
        ...response,
        onClick: () => {
          handleQuickResponse(response.id, response.messageToken);
        },
        isDisabled: response.isDisabled || isProcessing || selectedResponse !== null,
        content: response.content,
      }))}
      extraContent={
        extraContent
          ? {
              afterMainContent: extraContent,
            }
          : undefined
      }
      additionalRehypePlugins={[rehypeRaw, rehypeSanitize]}
    />
  );
};

export default ReceivedMessage;
