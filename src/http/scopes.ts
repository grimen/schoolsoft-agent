/**
 * The connector's OAuth scopes: one per offered operation, plus detail scopes. A
 * detail scope widens what one operation returns (other families' contact details
 * in contact lists), grants nothing without that operation, is offered only when
 * the operation is, and is never ticked in advance on the consent page. See
 * docs/planning/specs/2026-09-28-other-families-data.md.
 */
export interface DetailScope {
  /** `<operation>_details`: can never collide with an operation's scope. */
  scope: string;
  /** The operation whose answer it widens. */
  operation: string;
  /** What the parent allows, on the consent page. */
  title: string;
  /** Why to think twice, on the consent page. */
  warning: string;
}

export const DETAIL_SCOPES: readonly DetailScope[] = [
  {
    scope: "get_contacts_details",
    operation: "get_contacts",
    title: "Other families' e-mail addresses and phone numbers in the class contact list",
    warning:
      "This sends other families' e-mail addresses and phone numbers to your AI provider. They have not agreed to it. Without it, the app sees their names and roles only.",
  },
];

export function detailScope(scope: string): DetailScope | undefined {
  return DETAIL_SCOPES.find((detail) => detail.scope === scope);
}

/** The scopes a connector offering `operations` accepts. */
export function offeredScopes(operations: readonly string[]): string[] {
  return [
    ...operations,
    ...DETAIL_SCOPES.filter((detail) => operations.includes(detail.operation)).map(
      (detail) => detail.scope,
    ),
  ];
}

/** `scopes` without a detail scope whose operation is not among them. */
export function effectiveScopes(scopes: readonly string[]): string[] {
  return scopes.filter((scope) => {
    const detail = detailScope(scope);
    return !detail || scopes.includes(detail.operation);
  });
}

/** Whether a token's scopes reveal other families' contact details. */
export function grantsContactDetails(scopes: readonly string[]): boolean {
  return effectiveScopes(scopes).includes("get_contacts_details");
}
