export type Contact = {
  id: string;
  accountId: string | null;
  firstName: string;
  lastName: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
  preferredLanguage: string | null;
  timezone: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type ContactListFilters = {
  search?: string;
  accountId?: string;
  status?: "active" | "inactive" | "all";
  limit?: number;
  offset?: number;
};

export type ContactListResponse = { rows: Contact[]; total: number; limit: number; offset: number };
