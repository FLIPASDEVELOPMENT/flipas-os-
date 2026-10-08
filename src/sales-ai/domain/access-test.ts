export function accessTestMessage(code: string | null) {
  switch (code) {
    case "ACCOUNT_MISMATCH":
      return "Zoho returned a different mailbox. Reconnect the intended account before sending.";
    case "WRITE_AUTH_REQUIRED":
      return "Sending authorization is missing or revoked. Reconnect sending OAuth.";
    case "TOKEN_REFRESH_FAILED":
      return "Zoho authorization could not be renewed. Check the connection and reconnect sending OAuth if needed.";
    case "AUTH_REQUIRED":
      return "Zoho authentication is unavailable. Check the private server configuration and connection.";
    case "ACCESS_DENIED":
      return "Zoho denied access. Check this account’s authorization and permissions.";
    case "RATE_LIMIT":
      return "Zoho temporarily limited requests. Wait before testing again.";
    default:
      return "Zoho access could not be confirmed. Check the connection and try again later. No provider details or secrets are displayed.";
  }
}
