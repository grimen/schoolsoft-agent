/**
 * Replaces the home directory in a message with `~`, so a fatal error that embeds a
 * file path (a stack trace, an ENOENT, a permission error) does not also carry the OS
 * user name (`/Users/<name>/...`, `/home/<name>/...`, `C:\Users\<name>\...`).
 */
export function redactHome(message: string, home: string): string {
  if (!home) return message;
  // Every slash style the same path could appear in: as given, and with the other
  // platform's separator (a message can quote a path built with either).
  const variants = new Set([home, home.replace(/\\/g, "/"), home.replace(/\//g, "\\")]);
  let result = message;
  for (const variant of variants) result = result.split(variant).join("~");
  return result;
}
