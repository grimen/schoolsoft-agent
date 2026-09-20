export const FAKE_GUARDIAN: {
  userId: number;
  children: { studentId: number; firstName: string }[];
};
export const FAKE_UPSTREAM_CODE: string;
export const FAKE_UPSTREAM_SECRETS: string[];
export const FAKE_LUNCH_DISH: string;
export function fakeUpstream(): {
  fetchImpl: (
    url: string,
    school: string,
    request?: { method?: string; headers?: Record<string, string> },
  ) => Promise<{ status: number; data: unknown; headers: object; setCookies: string[] }>;
  calls: string[];
};
