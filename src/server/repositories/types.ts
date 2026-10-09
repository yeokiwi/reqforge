// Plain DTO shapes shared by the document repositories. Use cases depend on these, never on
// Prisma's generated types.

/** A user as pages show them: never an email address (spec 08 §3.1 `UserRef`). */
export interface UserRef {
  readonly id: string;
  readonly name: string;
}
