import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { mobileApi } from "@/core/api/client";
import { Button } from "@/shared/components/button";
import { StatusPill } from "@/shared/components/crm-states";
import { useTheme } from "@/shared/theme/theme";

type Row = Record<string, unknown>;
type Option = { id: string; name: string; slug?: string };

function values(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function toggle(items: string[], id: string) {
  return items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
}

function ChoiceList({ title, options, selected, multiple = false, onChange }: { title: string; options: Option[]; selected: string[]; multiple?: boolean; onChange(value: string[]): void }) {
  const { colors, spacing, type } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ ...type.caption, color: colors.textSecondary }}>{title}</Text>
      {options.map((option) => {
        const active = selected.includes(option.id);
        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(multiple ? toggle(selected, option.id) : [option.id])}
            style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: active ? colors.primary : colors.border, borderRadius: 10, backgroundColor: active ? colors.primarySoft : colors.surface }}
          >
            <Ionicons name={active ? "checkmark-circle" : "ellipse-outline"} size={20} color={active ? colors.primary : colors.textMuted} />
            <Text style={{ ...type.label, flex: 1, color: colors.text }}>{option.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AccessManager({ area, data, onChanged }: { area: "users" | "roles"; data: Record<string, unknown>; onChanged(): Promise<unknown> | void }) {
  const { colors, radii, spacing, type } = useTheme();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [invite, setInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [form, setForm] = useState<Record<string, string | string[]>>({});
  const users = (data.users as Row[] | undefined) || [];
  const invitations = (data.invitations as Row[] | undefined) || [];
  const roles = ((data.options as { roles?: Option[] } | undefined)?.roles || (data.roles as Row[] | undefined) || []).map((row) => ({ id: String(row.id), name: String(row.name), slug: row.slug ? String(row.slug) : undefined }));
  const options = (data.options as Record<string, Option[]> | undefined) || {};
  const permissions = ((data.permissions as Row[] | undefined) || []).map((row) => ({ id: String(row.key), name: `${String(row.category)} · ${String(row.name)}` }));
  const canManage = area === "roles" || Boolean(data.canManage);

  const mutation = useMutation({
    mutationFn: async (input: { path: string; method: "POST" | "PATCH"; body: Row }) =>
      mobileApi.apiRequest<{ message?: string; developmentUrl?: string }>(input.path, {
        method: input.method,
        body: JSON.stringify(input.body),
      }),
    onSuccess: async (result) => {
      setEditing(null);
      setInvite(false);
      setInviteEmail("");
      setInviteRole("");
      await onChanged();
      Alert.alert("Completed", result.message || "Access settings updated.");
    },
    onError: (error) => Alert.alert("Request not completed", error.message),
  });

  const openUser = (user: Row) => {
    setEditing(user);
    setForm({
      roleId: String(user.role_id || ""),
      status: String(user.status || "active"),
      companyIds: values(user.company_ids),
      branchIds: values(user.branch_ids),
      departmentIds: values(user.department_ids),
    });
  };
  const openRole = (role: Row = {}) => {
    setEditing(role);
    setForm({
      name: String(role.name || ""),
      slug: String(role.slug || ""),
      description: String(role.description || ""),
      permissionKeys: values(role.permission_keys),
    });
  };
  const submit = () => {
    if (!editing) return;
    if (area === "users") {
      mutation.mutate({ path: `/users/${String(editing.user_id)}`, method: "PATCH", body: form });
    } else {
      const id = String(editing.id || "");
      mutation.mutate({ path: id ? `/roles/${id}` : "/roles", method: id ? "PATCH" : "POST", body: form });
    }
  };
  const filtered = (rows: Row[]) => {
    const term = filter.trim().toLowerCase();
    return term ? rows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(term))) : rows;
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View style={{ minHeight: 48, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface }}>
          <Ionicons name="search" size={19} color={colors.textMuted} />
          <TextInput placeholder={`Search ${area}`} placeholderTextColor={colors.textMuted} value={filter} onChangeText={setFilter} style={{ ...type.body, flex: 1, color: colors.text }} />
        </View>
        {canManage ? (
          <Pressable onPress={() => area === "users" ? setInvite(true) : openRole()} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.sm, backgroundColor: colors.primary }}>
            <Ionicons name="add" size={24} color={colors.inverse} />
          </Pressable>
        ) : null}
      </View>

      <Text style={{ ...type.heading, color: colors.text }}>{area === "users" ? "Organisation members" : "Organisation roles"}</Text>
      {filtered(area === "users" ? users : ((data.roles as Row[] | undefined) || [])).map((row) => (
        <View key={String(row.user_id || row.id)} style={{ padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><Text style={{ ...type.label, color: colors.text }}>{String(row.full_name || row.name)}</Text><Text style={{ ...type.caption, color: colors.textMuted }}>{String(row.email || row.slug || "")}</Text></View>
            {row.status ? <StatusPill value={String(row.status)} /> : row.is_system ? <StatusPill value="system" /> : null}
          </View>
          <Text style={{ ...type.caption, color: colors.textSecondary }}>{area === "users" ? String(row.role_name || "No role") : `${String(row.user_count || 0)} users · ${values(row.permission_keys).length} permissions`}</Text>
          {canManage && !(area === "roles" && row.is_system) ? (
            <Pressable onPress={() => area === "users" ? openUser(row) : openRole(row)} style={{ minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm }}><Text style={{ ...type.label, color: colors.primary }}>Edit access</Text></Pressable>
          ) : null}
        </View>
      ))}

      {area === "users" ? (
        <>
          <Text style={{ ...type.heading, color: colors.text }}>Invitations</Text>
          {filtered(invitations).map((row) => (
            <View key={String(row.id)} style={{ padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, gap: spacing.sm }}>
              <Text style={{ ...type.label, color: colors.text }}>{String(row.email)}</Text>
              <Text style={{ ...type.caption, color: colors.textMuted }}>{String(row.role_name)} · expires {String(row.expires_at)}</Text>
              {!row.accepted_at && !row.revoked_at && canManage ? (
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Button style={{ flex: 1 }} label="Resend" variant="secondary" onPress={() => mutation.mutate({ path: `/invitations/${String(row.id)}`, method: "PATCH", body: { action: "resend" } })} />
                  <Button style={{ flex: 1 }} label="Revoke" variant="quiet" onPress={() => mutation.mutate({ path: `/invitations/${String(row.id)}`, method: "PATCH", body: { action: "revoke" } })} />
                </View>
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      <Modal visible={Boolean(editing)} animationType="slide" onRequestClose={() => setEditing(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}><Text style={{ ...type.heading, flex: 1, color: colors.text }}>{area === "users" ? "Edit user access" : editing?.id ? "Edit role" : "Create role"}</Text><Pressable onPress={() => setEditing(null)}><Ionicons name="close" size={24} color={colors.textSecondary} /></Pressable></View>
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
            {area === "users" ? (
              <>
                <ChoiceList title="Role" options={roles} selected={[String(form.roleId || "")]} onChange={(value) => setForm((current) => ({ ...current, roleId: value[0] || "" }))} />
                <ChoiceList title="Status" options={[{ id: "active", name: "Active" }, { id: "disabled", name: "Disabled" }]} selected={[String(form.status || "active")]} onChange={(value) => setForm((current) => ({ ...current, status: value[0] || "active" }))} />
                <ChoiceList title="Company access" options={options.companies || []} selected={values(form.companyIds)} multiple onChange={(value) => setForm((current) => ({ ...current, companyIds: value }))} />
                <ChoiceList title="Branch access" options={(options.branches || []).map((item) => ({ ...item, name: item.name }))} selected={values(form.branchIds)} multiple onChange={(value) => setForm((current) => ({ ...current, branchIds: value }))} />
                <ChoiceList title="Department access" options={options.departments || []} selected={values(form.departmentIds)} multiple onChange={(value) => setForm((current) => ({ ...current, departmentIds: value }))} />
              </>
            ) : (
              <>
                {(["name", "slug", "description"] as const).map((key) => <View key={key} style={{ gap: 5 }}><Text style={{ ...type.caption, color: colors.textSecondary }}>{key === "slug" ? "Slug (lowercase and underscores)" : key.replace(/^./, (letter) => letter.toUpperCase())}</Text><TextInput multiline={key === "description"} value={String(form[key] || "")} onChangeText={(value) => setForm((current) => ({ ...current, [key]: value }))} style={{ ...type.body, minHeight: key === "description" ? 92 : 48, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }} /></View>)}
                <ChoiceList title="Permissions" options={permissions} selected={values(form.permissionKeys)} multiple onChange={(value) => setForm((current) => ({ ...current, permissionKeys: value }))} />
              </>
            )}
            <Button label={mutation.isPending ? "Saving…" : "Save changes"} disabled={mutation.isPending} onPress={submit} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={invite} animationType="slide" onRequestClose={() => setInvite(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}><Text style={{ ...type.heading, flex: 1, color: colors.text }}>Invite team member</Text><Pressable onPress={() => setInvite(false)}><Ionicons name="close" size={24} color={colors.textSecondary} /></Pressable></View>
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
            <View style={{ gap: 5 }}><Text style={{ ...type.caption, color: colors.textSecondary }}>Work email</Text><TextInput keyboardType="email-address" autoCapitalize="none" value={inviteEmail} onChangeText={setInviteEmail} style={{ ...type.body, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }} /></View>
            <ChoiceList title="Role" options={roles.filter((role) => role.slug !== "organization_owner")} selected={[inviteRole]} onChange={(value) => setInviteRole(value[0] || "")} />
            <Button label={mutation.isPending ? "Sending…" : "Send invitation"} disabled={mutation.isPending || !inviteEmail || !inviteRole} onPress={() => mutation.mutate({ path: "/invitations", method: "POST", body: { email: inviteEmail, roleId: inviteRole, companyIds: [], branchIds: [], departmentIds: [] } })} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
