type Client = any;
type Context = { organizationId: string; userId: string; permissions: readonly string[]; roleSlugs: readonly string[] };
export type RelatedDocument = { id: string; number: string | null; status: string | null; date: string | null; amount: string | null; currency: string | null; detail: string | null; href: string };
export type RelatedDocumentGroup = { key: string; label: string; direction: "upstream" | "downstream" | "demand" | "supply" | "movement" | "control"; documents: RelatedDocument[] };
export type RelatedDocumentType = "purchase_order" | "opportunity" | "lead" | "item";
export declare const RELATED_DOCUMENT_TYPES: readonly RelatedDocumentType[];
export declare class RelatedDocumentsError extends Error { status: number; code: string; constructor(status: number, message: string, code: string); }
export declare function getRelatedDocuments(client: Client, context: Context, type: string, id: string): Promise<{ record: { type: RelatedDocumentType; id: string; number: string | null }; groups: RelatedDocumentGroup[] }>;
