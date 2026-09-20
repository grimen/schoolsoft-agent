export function runConnectorFlow(options: {
  base: string;
  origin: string;
  adminPassword: string;
  log?: (step: string) => void;
}): Promise<{ steps: string[] }>;
