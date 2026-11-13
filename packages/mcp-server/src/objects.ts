import { DOMAIN_OBJECT_TYPES, metadataFields, validateTypeMetadata, type DomainObjectType } from "@kortex/db";

// Die Zod-Schemas der Objekttypen leben in der Typ-Registry (@kortex/db, type-registry.ts).
// Dieses Modul bleibt als dünne, unveränderte API für die MCP-Tools.

/** Field names per object type, for tool descriptions and error messages. */
export const OBJECT_FIELDS = Object.fromEntries(
  DOMAIN_OBJECT_TYPES.map((t) => [t, metadataFields(t)]),
) as Record<DomainObjectType, string[]>;

export function validateObjectMetadata(
  type: DomainObjectType,
  metadata: Record<string, unknown>,
): { ok: true; metadata: Record<string, unknown> } | { ok: false; error: string } {
  return validateTypeMetadata(type, metadata);
}
