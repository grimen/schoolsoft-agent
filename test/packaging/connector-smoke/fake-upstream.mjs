/** Synthetic stand-in for the school portal's HTTP API, injected at the provider's
 * fetch seam (SessionDeps.fetchImpl). It answers the whole login and read sequence
 * from memory, so the connector under test never opens an outbound connection.
 * Plain ESM without dependencies: the container smoke mounts it into the image.
 */
export const FAKE_GUARDIAN = {
  userId: 9001,
  children: [
    { studentId: 201, firstName: "Synthetic Alva" },
    { studentId: 202, firstName: "Synthetic Bo" },
  ],
};
export const FAKE_UPSTREAM_CODE = "synthetic-upstream-code";
export const FAKE_UPSTREAM_SECRETS = ["SYNTHETIC_UPSTREAM_ACCESS", "SYNTHETIC_UPSTREAM_REFRESH"];
export const FAKE_LUNCH_DISH = "Synthetic pancakes";

export function fakeUpstream() {
  /** Every upstream request the connector attempted, as "METHOD path". */
  const calls = [];
  const reply = (status, data, setCookies = []) => ({ status, data, headers: {}, setCookies });
  const fetchImpl = async (url, _school, request = {}) => {
    const { pathname: tenantPath, searchParams } = new URL(url);
    // Portal URLs are /<school>/<path>; the fake serves one synthetic tenant.
    const pathname = tenantPath.replace(/^\/[^/]+/, "");
    calls.push(`${request.method ?? "GET"} ${pathname}`);
    if (pathname === "/rest-api/login/token") {
      const grant = searchParams.get("grantType");
      const accepted =
        grant === "refresh_token"
          ? searchParams.get("refreshToken") === FAKE_UPSTREAM_SECRETS[1]
          : searchParams.get("code") === FAKE_UPSTREAM_CODE &&
            (searchParams.get("codeVerifier") ?? "").length >= 43;
      return accepted
        ? reply(200, {
            access_token: FAKE_UPSTREAM_SECRETS[0],
            refresh_token: FAKE_UPSTREAM_SECRETS[1],
            expires: 3600,
          })
        : reply(400, { userMessage: "synthetic rejection" });
    }
    if (
      request.headers?.Authorization !== `Bearer ${FAKE_UPSTREAM_SECRETS[0]}` &&
      pathname.startsWith("/eva/")
    )
      return reply(401, null);
    if (pathname === "/eva/api/v1/parent")
      return reply(200, {
        userId: FAKE_GUARDIAN.userId,
        firstName: "Synthetic",
        lastName: "Guardian",
        children: FAKE_GUARDIAN.children.map((child) => ({
          ...child,
          lastName: "Fixture",
          schools: [{ orgId: 30, name: "Synthetic School", className: "0A" }],
        })),
      });
    if (pathname.startsWith("/eva-apps/auth/login/")) {
      const child = request.headers?.childInFocus;
      return reply(303, "", [`JSESSIONID=child-${child}; Path=/`, "hash=synthetic; Path=/"]);
    }
    if (/^\/eva\/api\/v1\/schools\/30\/lunchmenu\/\d+$/.test(pathname))
      return reply(200, [
        {
          week: Number(pathname.split("/").pop()),
          dayId: 1,
          dishes: [{ mealType: "Lunch", description: FAKE_LUNCH_DISH }],
        },
      ]);
    // Cookie-bound reads echo which child's session served them.
    const focus = /JSESSIONID=child-(\d+)/.exec(request.headers?.Cookie ?? "")?.[1];
    if (!focus) return reply(401, null);
    if (pathname === "/rest-api/session") return reply(200, { synthetic: true });
    if (/^\/rest-api\/parent\/calendar\/lessons\/week\/\d+$/.test(pathname))
      return reply(200, [
        {
          name: "Synthetic lesson",
          servedForChild: Number(focus),
          startDate: "2026-09-07T08:00",
          endDate: "2026-09-07T09:00",
        },
      ]);
    if (pathname === "/rest-api/parent/calendar/lessons/agenda")
      return reply(200, [
        {
          eventId: 1,
          name: "Synthetic lesson",
          startDate: "2026-09-07T08:00",
          endDate: "2026-09-07T09:00",
          allDay: false,
        },
      ]);
    if (pathname === "/rest-api/parent/calendar/event/agenda")
      return reply(200, [
        {
          eventId: 2,
          name: "Synthetic school event",
          startDate: "2026-09-08",
          endDate: "2026-09-08",
          allDay: true,
        },
      ]);
    return reply(404, null);
  };
  return { fetchImpl, calls };
}
