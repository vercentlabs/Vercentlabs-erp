import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, type Href } from "expo-router";
import { useState, type ReactNode } from "react";
import {
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { mobileApi } from "@/core/api/client";
import { useAuth } from "@/core/auth/auth-provider";
import { AppHeader } from "@/shared/components/app-header";
import { AccessManager } from "@/shared/components/access-manager";
import { BillingManager } from "@/shared/components/billing-manager";
import { Button } from "@/shared/components/button";
import { QueryState, StatusPill } from "@/shared/components/crm-states";
import { Screen } from "@/shared/components/screen";
import { useTheme } from "@/shared/theme/theme";

type Row = Record<string, unknown>;
type PageResponse = {
  page: {
    area: string;
    eyebrow: string;
    title: string;
    description: string;
    data: Record<string, unknown>;
  };
};

function words(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(String).join(", ") || "—";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}T/.test(text) ? new Date(text) : null;
  if (date && !Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
  return text.replaceAll("_", " ");
}

function Panel({ children }: { children: ReactNode }) {
  const { colors, radii, spacing } = useTheme();
  return (
    <View style={{ padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, gap: spacing.md }}>
      {children}
    </View>
  );
}

function RecordCard({ row, fields }: { row: Row; fields: string[] }) {
  const { colors, spacing, type } = useTheme();
  const title = String(
    row.title || row.name || row.full_name || row.fullName || row.email || row.event_type || row.provider_invoice_id || row.id || "Record",
  );
  return (
    <Panel>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <Text style={{ ...type.label, flex: 1, color: colors.text }}>{title}</Text>
        {row.status ? <StatusPill value={String(row.status)} /> : null}
      </View>
      {fields.filter((key) => row[key] !== undefined && key !== "status").map((key) => (
        <View key={key} style={{ flexDirection: "row", gap: spacing.sm }}>
          <Text style={{ ...type.caption, width: 106, color: colors.textMuted }}>{words(key)}</Text>
          <Text style={{ ...type.caption, flex: 1, color: colors.textSecondary }}>{display(row[key])}</Text>
        </View>
      ))}
    </Panel>
  );
}

function Metric({
  label,
  value,
  description,
  icon = "analytics-outline",
  href,
}: {
  label: string;
  value: unknown;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  href?: Href;
}) {
  const { colors, radii, spacing, type } = useTheme();
  return (
    <Pressable
      disabled={!href}
      onPress={() => href && router.push(href)}
      style={({ pressed }) => ({ width: "47%", minWidth: 145, flexGrow: 1, minHeight: 138, padding: spacing.md, borderWidth: 1, borderColor: pressed ? colors.primary : colors.border, borderRadius: radii.md, backgroundColor: colors.surface, gap: spacing.sm })}
    >
      <View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#F2F4F7" }}>
        <Ionicons name={icon} size={21} color={colors.textSecondary} />
      </View>
      <Text style={{ ...type.heading, fontSize: 29, color: colors.text }}>{display(value)}</Text>
      <Text style={{ ...type.caption, color: colors.textMuted }}>{label}</Text>
      {description ? <Text style={{ ...type.caption, fontSize: 11, color: colors.textMuted }}>{description}</Text> : null}
    </Pressable>
  );
}

function ActionCard({
  label,
  description,
  icon,
  href,
}: {
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: Href;
}) {
  const { colors, radii, spacing, type } = useTheme();
  return (
    <Pressable
      onPress={() => router.push(href)}
      style={({ pressed }) => ({ minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: pressed ? colors.primary : colors.border, borderRadius: radii.md, backgroundColor: colors.surface })}
    >
      <View style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.primarySoft }}>
        <Ionicons name={icon} size={21} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.label, color: colors.text }}>{label}</Text>
        <Text style={{ ...type.caption, color: colors.textMuted }}>{description}</Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export function WorkspacePage({ area }: { area: string }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { colors, radii, spacing, type } = useTheme();
  const [filter, setFilter] = useState("");
  const [profile, setProfile] = useState<Partial<{ fullName: string; locale: string; timezone: string; theme: string }>>({});
  const [password, setPassword] = useState({ currentPassword: "", password: "", confirmPassword: "" });
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const query = useQuery({
    queryKey: ["workspace-page", area],
    queryFn: () => mobileApi.request<PageResponse>(`/workspace/${area}`),
  });
  const page = query.data?.page;
  const data = page?.data ?? {};

  const profileUser = data.user as Row | undefined;
  const profilePreferences = data.preferences as Row | undefined;
  const profileDefaults = {
    fullName: String(profileUser?.fullName || ""),
    locale: String(profilePreferences?.locale || "en-IN"),
    timezone: String(profilePreferences?.timezone || "Asia/Kolkata"),
    theme: String(profilePreferences?.theme || "system"),
  };
  const profileInput = { ...profileDefaults, ...profile };

  const action = useMutation({
    mutationFn: async (input: { path?: string; method: "POST" | "PATCH"; body: Row }) =>
      mobileApi.request<{ message?: string }>(input.path || `/workspace/${area}`, {
        method: input.method,
        body: JSON.stringify(input.body),
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-page", area] });
      Alert.alert("Completed", result.message || "The workspace was updated.");
    },
    onError: (error) => Alert.alert("Request not completed", error.message),
  });

  const rowsFor = (key: string) => ((data[key] as Row[] | undefined) || []);
  const filtered = (rows: Row[]) => {
    const term = filter.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(term)));
  };
  const search = (
    <View style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface }}>
      <Ionicons name="search" size={19} color={colors.textMuted} />
      <TextInput placeholder="Search" placeholderTextColor={colors.textMuted} value={filter} onChangeText={setFilter} style={{ ...type.body, flex: 1, color: colors.text, paddingVertical: 0 }} />
    </View>
  );

  const content = (() => {
    if (!page) return null;
    if (area === "dashboard") {
      const counts = (data.counts || {}) as Row;
      const permissionSet = new Set(auth.session?.access.permissions || []);
      const quickActions = [
        ["Add company", "Expand the legal entity structure", "briefcase-outline", "/(protected)/workspace/settings/companies", "company.manage"],
        ["Add branch", "Create another operating location", "git-branch-outline", "/(protected)/workspace/settings/branches", "branch.manage"],
        ["Invite user", "Give a team member controlled access", "person-add-outline", "/(protected)/workspace/users", "users.manage"],
        ["Configure roles", "Define least-privilege permissions", "key-outline", "/(protected)/workspace/roles", "roles.manage"],
      ] as const;
      return (
        <View style={{ gap: spacing.xl }}>
          <View style={{ padding: spacing.xl, borderRadius: 20, backgroundColor: colors.navigation, gap: spacing.md }}>
            <Text style={{ color: "#D0D5DD", fontSize: 12 }}>{new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</Text>
            <Text style={{ color: "#A5B4FC", fontSize: 11, fontWeight: "800", textTransform: "uppercase" }}>ERP workspace</Text>
            <Text style={{ ...type.display, fontSize: 36, color: colors.inverse }}>Welcome back, {auth.session?.user.fullName.split(" ")[0]}.</Text>
            <Text style={{ ...type.body, color: "#D0D5DD" }}>Review what needs attention, maintain the organisation foundation and move into the right operating context.</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              <Button label="Open modules" onPress={() => router.push("/(protected)/workspace/modules")} />
              <Button label="Workspace settings" variant="secondary" onPress={() => router.push("/(protected)/workspace/settings")} />
            </View>
          </View>
          <Panel>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <View style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.primarySoft }}><Ionicons name="business-outline" size={21} color={colors.primary} /></View>
              <View style={{ flex: 1 }}><Text style={{ ...type.caption, color: colors.textMuted }}>Current context</Text><Text style={{ ...type.label, color: colors.text }}>{auth.session?.workspace.organizationName}</Text></View>
              <StatusPill value="active" />
            </View>
            <RecordCard row={{ title: "Operating context", company: auth.session?.workspace.companyName || "Not selected", branch: auth.session?.workspace.branchName || "All branches", access: auth.session?.access.roleSlugs[0] || auth.session?.workspace.membershipRole }} fields={["company", "branch", "access"]} />
          </Panel>
          <View><Text style={{ color: colors.primary, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>At a glance</Text><Text style={{ ...type.heading, color: colors.text }}>Organisation overview</Text></View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {permissionSet.has("company.manage") ? <Metric label="Companies" value={counts.companies} description="Active legal entities" icon="briefcase-outline" href="/(protected)/workspace/settings/companies" /> : null}
            {permissionSet.has("branch.manage") ? <Metric label="Branches" value={counts.branches} description="Operating locations" icon="git-branch-outline" href="/(protected)/workspace/settings/branches" /> : null}
            {permissionSet.has("users.view") ? <Metric label="Active users" value={counts.users} description="People with workspace access" icon="people-outline" href="/(protected)/workspace/users" /> : null}
            {permissionSet.has("department.manage") ? <Metric label="Departments" value={counts.departments} description="Configured responsibility units" icon="layers-outline" href="/(protected)/workspace/settings/departments" /> : null}
            <Metric label="Unread notifications" value={counts.unread_notifications} description="New workspace updates" icon="notifications-outline" href="/(protected)/notifications" />
          </View>
          {quickActions.some((item) => permissionSet.has(item[4])) ? <View style={{ gap: spacing.sm }}><View><Text style={{ color: colors.primary, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>Common actions</Text><Text style={{ ...type.heading, color: colors.text }}>Keep the foundation current</Text></View>{quickActions.filter((item) => permissionSet.has(item[4])).map(([label, description, icon, href]) => <ActionCard key={label} label={label} description={description} icon={icon} href={href} />)}</View> : null}
          <View style={{ gap: spacing.sm }}>
            <Text style={{ ...type.heading, color: colors.text }}>Your open activities</Text>
            {rowsFor("activities").map((row) => <RecordCard key={String(row.id)} row={row} fields={["due_at"]} />)}
            {!rowsFor("activities").length ? <Panel><Text style={{ ...type.label, color: colors.text }}>No open activities</Text><Text style={{ ...type.body, color: colors.textMuted }}>Assigned ERP tasks will appear here.</Text></Panel> : null}
          </View>
          {rowsFor("recentEvents").length ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={{ ...type.heading, color: colors.text }}>Latest audit events</Text>
              {rowsFor("recentEvents").map((row, index) => <RecordCard key={String(row.id || index)} row={row} fields={["actor_name", "entity_type", "created_at"]} />)}
            </View>
          ) : null}
        </View>
      );
    }
    if (area === "procurement") {
      const dashboard = (data.dashboard || {}) as Row;
      const metrics: [string, unknown, keyof typeof Ionicons.glyphMap][] = [
        ["Pending requisitions", dashboard.pending_requisitions, "document-text-outline"],
        ["Active sourcing", dashboard.active_sourcing, "git-compare-outline"],
        ["Open purchase orders", dashboard.open_orders, "cart-outline"],
        ["Pending receipts", dashboard.pending_receipts, "download-outline"],
        ["Matching exceptions", dashboard.match_exceptions, "warning-outline"],
        ["Supplier risks", dashboard.supplier_risks, "shield-outline"],
      ];
      return (
        <View style={{ gap: spacing.xl }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {metrics.map(([label, value, icon]) => (
              <Metric key={label} label={label} value={value || 0} icon={icon} />
            ))}
          </View>
          <Panel>
            <Text style={{ ...type.heading, color: colors.text }}>Enterprise Procurement</Text>
            <Text style={{ ...type.body, color: colors.textMuted }}>
              Mobile provides a secure operational summary. Complex sourcing comparisons,
              contract amendments and bulk line editing remain available in the responsive web workspace.
            </Text>
          </Panel>
        </View>
      );
    }
    if (area === "crm") {
      const dashboard = (data.dashboard || {}) as Row;
      const metrics = (dashboard.metrics || {}) as Row;
      const currency = String(metrics.currencyCode || "INR");
      const money = (value: unknown) => new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value || 0));
      const metricItems: [string, unknown, string][] = [
        ["Open leads", metrics.openLeads, "leads"], ["Qualified leads", metrics.qualifiedLeads, "qualified"],
        ["Open opportunities", metrics.openOpportunities, "opportunities"], ["Pipeline value", money(metrics.pipelineValue), "pipeline"],
        ["Weighted forecast", money(metrics.weightedPipeline), "forecast"], ["Overdue follow-ups", metrics.overdueActivities, "overdue"],
        ["Due today", metrics.dueToday, "today"], ["Conversions this month", metrics.conversionsThisMonth, "conversion"],
      ];
      return (
        <View style={{ gap: spacing.xl }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            <Button label="Create lead" onPress={() => router.push({ pathname: "/(protected)/workspace/[area]/[resource]", params: { area: "crm", resource: "leads", create: "1" } })} />
            <Button label="Create opportunity" variant="secondary" onPress={() => router.push({ pathname: "/(protected)/workspace/[area]/[resource]", params: { area: "crm", resource: "opportunities", create: "1" } })} />
            <Button label="Create activity" variant="secondary" onPress={() => router.push({ pathname: "/(protected)/workspace/[area]/[resource]", params: { area: "crm", resource: "activities", create: "1" } })} />
            <Button label="Open pipeline" variant="secondary" onPress={() => router.push("/(protected)/(tabs)/pipeline")} />
            <Button label="CRM settings" variant="secondary" onPress={() => router.push("/(protected)/workspace/crm-settings")} />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>{metricItems.map(([label, value, hint]) => <Metric key={label} label={label} value={value} description={hint} icon="people-outline" />)}</View>
          <View style={{ gap: spacing.sm }}><View style={{ flexDirection: "row", alignItems: "center" }}><View style={{ flex: 1 }}><Text style={{ color: colors.primary, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>Pipeline</Text><Text style={{ ...type.heading, color: colors.text }}>Stage health</Text></View><Pressable onPress={() => router.push("/(protected)/(tabs)/pipeline")}><Text style={{ ...type.label, color: colors.primary }}>View Kanban</Text></Pressable></View>{((dashboard.stages || []) as Row[]).map((row) => <RecordCard key={String(row.id)} row={{ title: row.name, opportunities: row.opportunityCount, amount: money(row.amount) }} fields={["opportunities", "amount"]} />)}</View>
          <View style={{ gap: spacing.sm }}><View style={{ flexDirection: "row", alignItems: "center" }}><View style={{ flex: 1 }}><Text style={{ color: colors.primary, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>Lead sources</Text><Text style={{ ...type.heading, color: colors.text }}>Acquisition quality</Text></View><Pressable onPress={() => router.push("/(protected)/workspace/crm-reports")}><Text style={{ ...type.label, color: colors.primary }}>Reports</Text></Pressable></View>{((dashboard.sources || []) as Row[]).map((row, index) => <RecordCard key={`${String(row.name)}-${index}`} row={{ title: row.name, leads: row.leadCount, converted: row.convertedCount }} fields={["leads", "converted"]} />)}</View>
          <View style={{ gap: spacing.sm }}><View style={{ flexDirection: "row", alignItems: "center" }}><View style={{ flex: 1 }}><Text style={{ color: colors.primary, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>Next actions</Text><Text style={{ ...type.heading, color: colors.text }}>Upcoming and overdue work</Text></View><Pressable onPress={() => router.push({ pathname: "/(protected)/workspace/[area]/[resource]", params: { area: "crm", resource: "activities" } })}><Text style={{ ...type.label, color: colors.primary }}>Open centre</Text></Pressable></View>{((dashboard.activities || []) as Row[]).map((row) => <RecordCard key={String(row.id)} row={{ ...row, title: row.subject }} fields={["activityType", "assignedName", "dueAt"]} />)}{!((dashboard.activities || []) as Row[]).length ? <Panel><Text style={{ ...type.label, color: colors.text }}>No pending activities</Text><Text style={{ ...type.body, color: colors.textMuted }}>Create a task, call, meeting or follow-up for the next customer action.</Text><Button label="Create activity" onPress={() => router.push({ pathname: "/(protected)/workspace/[area]/[resource]", params: { area: "crm", resource: "activities", create: "1" } })} /></Panel> : null}</View>
        </View>
      );
    }
    if (area === "profile") {
      const user = data.user as Row;
      return (
        <View style={{ gap: spacing.md }}>
          <Panel>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={{ width: 56, height: 56, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.primary }}>
                <Text style={{ ...type.heading, color: colors.inverse }}>{String(user?.fullName || "U").slice(0, 1)}</Text>
              </View>
              <View style={{ flex: 1 }}><Text style={{ ...type.heading, color: colors.text }}>{String(user?.fullName)}</Text><Text style={{ ...type.caption, color: colors.textMuted }}>{String(user?.email)}</Text></View>
            </View>
          </Panel>
          <Panel>
            <Text style={{ ...type.heading, color: colors.text }}>Profile settings</Text>
            {(["fullName", "locale", "timezone", "theme"] as const).map((key) => (
              <View key={key} style={{ gap: 5 }}><Text style={{ ...type.caption, color: colors.textSecondary }}>{words(key)}</Text><TextInput value={profileInput[key]} onChangeText={(value) => setProfile((current) => ({ ...current, [key]: value }))} style={{ ...type.body, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }} /></View>
            ))}
            <Button label="Save profile" loading={action.isPending} onPress={() => action.mutate({ method: "PATCH", body: profileInput })} />
          </Panel>
          <Text style={{ ...type.heading, color: colors.text }}>Recent authentication activity</Text>
          {rowsFor("logins").map((row, index) => <RecordCard key={index} row={row} fields={["created_at", "succeeded", "ip_address", "reason"]} />)}
        </View>
      );
    }
    if (area === "security") {
      return (
        <View style={{ gap: spacing.md }}>
          <Panel>
            <Text style={{ ...type.heading, color: colors.text }}>Change your password</Text>
            {(["currentPassword", "password", "confirmPassword"] as const).map((key) => (
              <View key={key} style={{ gap: 5 }}><Text style={{ ...type.caption, color: colors.textSecondary }}>{key === "password" ? "New password" : words(key)}</Text><TextInput secureTextEntry value={password[key]} onChangeText={(value) => setPassword((current) => ({ ...current, [key]: value }))} style={{ ...type.body, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }} /></View>
            ))}
            <Text style={{ ...type.caption, color: colors.textMuted }}>Changing your password revokes all sessions and requires sign-in again.</Text>
            <Button label="Change password" loading={action.isPending} onPress={() => action.mutate({ method: "POST", body: password })} />
          </Panel>
          <View style={{ flexDirection: "row", alignItems: "center" }}><Text style={{ ...type.heading, flex: 1, color: colors.text }}>Active sessions</Text><Pressable onPress={() => action.mutate({ method: "PATCH", body: { action: "revoke-others" } })}><Text style={{ ...type.label, color: colors.danger }}>Revoke others</Text></Pressable></View>
          {rowsFor("sessions").map((row) => (
            <View key={String(row.id)}><RecordCard row={row} fields={["session_type", "device_platform", "ip_address", "last_seen_at", "expires_at"]} />{String(row.id) !== String(data.currentSessionId) ? <Pressable onPress={() => action.mutate({ method: "PATCH", body: { action: "revoke", sessionId: row.id } })} style={{ alignSelf: "flex-end", marginTop: -44, marginRight: spacing.md, marginBottom: spacing.md }}><Text style={{ ...type.label, color: colors.danger }}>Revoke</Text></Pressable> : null}</View>
          ))}
        </View>
      );
    }
    if (area === "billing") {
      return <BillingManager data={data} onChanged={() => query.refetch()} />;
    }
    if (area === "approvals") {
      return (
        <View style={{ gap: spacing.md }}>
          {search}
          {filtered(rowsFor("rows")).map((row) => (
            <View key={String(row.id)} style={{ gap: spacing.sm }}>
              <RecordCard row={row} fields={["entity_type", "entity_id", "requester", "requested_at"]} />
              {row.status === "pending" && row.command_key ? (
                <Panel>
                  <TextInput placeholder="Decision note (required when rejecting)" placeholderTextColor={colors.textMuted} value={decisionNotes[String(row.id)] || ""} onChangeText={(value) => setDecisionNotes((current) => ({ ...current, [String(row.id)]: value }))} style={{ ...type.body, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }} />
                  <View style={{ flexDirection: "row", gap: spacing.sm }}><Button style={{ flex: 1 }} label="Approve" onPress={() => action.mutate({ path: `/approvals/${String(row.id)}`, method: "PATCH", body: { action: "approve", note: decisionNotes[String(row.id)] || "", expectedVersion: row.version } })} /><Button style={{ flex: 1 }} label="Reject" variant="secondary" onPress={() => action.mutate({ path: `/approvals/${String(row.id)}`, method: "PATCH", body: { action: "reject", note: decisionNotes[String(row.id)] || "", expectedVersion: row.version } })} /></View>
                </Panel>
              ) : null}
            </View>
          ))}
        </View>
      );
    }
    if (area === "audit-logs") {
      return <View style={{ gap: spacing.md }}>{search}{filtered(rowsFor("rows")).map((row) => <RecordCard key={String(row.id)} row={row} fields={["created_at", "event_type", "actor_name", "actor_email", "entity_type", "entity_id", "ip_address"]} />)}</View>;
    }
    if (area === "crm-reports") {
      const reports = (data.reports || {}) as Record<string, { rows?: Row[] }>;
      return (
        <View style={{ gap: spacing.xl }}>
          {(Array.isArray(data.names) ? data.names.map(String) : []).map((name) => {
            const rows = reports[name]?.rows || [];
            const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
            return (
              <View key={name} style={{ gap: spacing.sm }}>
                <Text style={{ ...type.caption, color: colors.primary, textTransform: "uppercase" }}>Report</Text>
                <Text style={{ ...type.heading, color: colors.text }}>{words(name)}</Text>
                {rows.length ? rows.map((row, index) => <RecordCard key={index} row={{ title: words(name), ...row }} fields={columns} />) : <Panel><Text style={{ ...type.body, color: colors.textMuted }}>No report data yet.</Text></Panel>}
              </View>
            );
          })}
        </View>
      );
    }
    if (area === "users") {
      return <AccessManager area="users" data={data} onChanged={() => query.refetch()} />;
    }
    if (area === "roles") {
      return <AccessManager area="roles" data={data} onChanged={() => query.refetch()} />;
    }
    if (area === "modules") {
      const statuses = new Map(
        rowsFor("statuses").map((row) => [String(row.module_key), String(row.status)]),
      );
      return (
        <View style={{ gap: spacing.md }}>
          <Panel>
            <Text style={{ ...type.label, color: colors.text }}>Build depth before breadth</Text>
            <Text style={{ ...type.body, color: colors.textMuted }}>Each module becomes valuable when its records, approvals, audit trail and connected business flow are complete.</Text>
          </Panel>
          {rowsFor("modules").map((module, index) => {
            const released = module.availability === "released";
            const status = released ? statuses.get(String(module.key)) || "enabled" : "roadmap";
            return (
              <Panel key={String(module.key)}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ ...type.caption, flex: 1, color: colors.textMuted }}>{String(index + 1).padStart(2, "0")}</Text>
                  <StatusPill value={status} />
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                  <View style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.primarySoft }}><Ionicons name="apps-outline" size={23} color={colors.primary} /></View>
                  <View style={{ flex: 1 }}><Text style={{ ...type.heading, color: colors.text }}>{String(module.name)}</Text><Text style={{ ...type.body, color: colors.textMuted }}>{String(module.description)}</Text></View>
                </View>
                <Text style={{ ...type.caption, color: colors.textMuted }}>{released ? "Included in this release" : "Planned for a future release"}</Text>
              </Panel>
            );
          })}
        </View>
      );
    }
    return null;
  })();

  return (
    <Screen>
      <AppHeader eyebrow={page?.eyebrow || "Workspace"} title={page?.title || words(area)} description={page?.description} />
      <QueryState loading={query.isLoading} error={query.error} empty={false} onRetry={() => void query.refetch()} />
      {content}
    </Screen>
  );
}
