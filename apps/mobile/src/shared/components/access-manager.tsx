import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { mobileApi } from "@/core/api/client";
import { Button } from "@/shared/components/button";
import { StatusPill } from "@/shared/components/crm-states";
import { useTheme } from "@/shared/theme/theme";

type Row = Record<string, unknown>;
type Option = {
  id: string;
  name: string;
  slug?: string;
  permission_keys?: unknown;
};

function values(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}
function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}
function toggle(items: string[], id: string) {
  return items.includes(id)
    ? items.filter((item) => item !== id)
    : [...items, id];
}

function ChoiceList({
  title,
  options,
  selected,
  multiple = false,
  onChange,
}: {
  title: string;
  options: Option[];
  selected: string[];
  multiple?: boolean;
  onChange(value: string[]): void;
}) {
  const { colors, spacing, type } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ ...type.caption, color: colors.textSecondary }}>
        {title}
      </Text>
      {options.map((option) => {
        const active = selected.includes(option.id);
        return (
          <Pressable
            key={option.id}
            onPress={() =>
              onChange(multiple ? toggle(selected, option.id) : [option.id])
            }
            style={{
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              borderWidth: 1,
              borderColor: active ? colors.primary : colors.border,
              borderRadius: 10,
              backgroundColor: active ? colors.primarySoft : colors.surface,
            }}
          >
            <Ionicons
              name={active ? "checkmark-circle" : "ellipse-outline"}
              size={20}
              color={active ? colors.primary : colors.textMuted}
            />
            <Text style={{ ...type.label, flex: 1, color: colors.text }}>
              {option.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AccessManager({
  area,
  data,
  onChanged,
}: {
  area: "users" | "roles";
  data: Record<string, unknown>;
  onChanged(): Promise<unknown> | void;
}) {
  const { colors, radii, spacing, type } = useTheme();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [invite, setInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoles, setInviteRoles] = useState<string[]>([]);
  const [invitePrimaryRole, setInvitePrimaryRole] = useState("");
  const [inviteWarningReviewed, setInviteWarningReviewed] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const users = (data.users as Row[] | undefined) || [];
  const invitations = (data.invitations as Row[] | undefined) || [];
  const options = (data.options as Record<string, Option[]> | undefined) || {};
  const roles = (
    options.roles ||
    ((data.roles as Row[] | undefined) || []).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      slug: row.slug ? text(row.slug) : undefined,
      permission_keys: row.permission_keys,
    }))
  ).filter((role) => role.slug !== "organization_owner");
  const permissions = ((data.permissions as Row[] | undefined) || []).map(
    (row) => ({
      id: text(row.key),
      name: `${text(row.category)} · ${text(row.name)}`,
    }),
  );
  const canManage = Boolean(data.canManage);

  const mutation = useMutation({
    mutationFn: async (input: {
      path: string;
      method: "POST" | "PATCH";
      body: Row;
    }) =>
      mobileApi.apiRequest<{ message?: string; developmentUrl?: string }>(
        input.path,
        { method: input.method, body: JSON.stringify(input.body) },
      ),
    onSuccess: async (result) => {
      setEditing(null);
      setInvite(false);
      setInviteEmail("");
      setInviteRoles([]);
      setInvitePrimaryRole("");
      setInviteWarningReviewed(false);
      await onChanged();
      Alert.alert("Completed", result.message || "Access settings updated.");
    },
    onError: (error) => Alert.alert("Request not completed", error.message),
  });

  const openUser = (user: Row) => {
    setEditing(user);
    setForm({
      roleIds: values(user.role_ids),
      primaryRoleId: text(user.primary_role_id),
      status: text(user.status || "active"),
      companyIds: values(user.company_ids),
      branchIds: values(user.branch_ids),
      departmentIds: values(user.department_ids),
      teamIds: values(user.team_ids),
      accessStartsAt: user.access_starts_at || null,
      accessExpiresAt: user.access_expires_at || null,
      reason: "Mobile access administration update",
      acknowledgeWarningConflicts: false,
    });
  };
  const openRole = (role: Row = {}) => {
    setEditing(role);
    setForm({
      name: text(role.name),
      slug: text(role.slug),
      description: text(role.description),
      moduleKey: text(role.module_key || "platform"),
      riskLevel: text(role.risk_level || "standard"),
      permissionKeys: values(role.permission_keys),
      acknowledgeWarningConflicts: false,
    });
  };
  const submit = () => {
    if (!editing) return;
    if (area === "users") {
      mutation.mutate({
        path: `/users/${text(editing.user_id)}`,
        method: "PATCH",
        body: form,
      });
    } else {
      const id = text(editing.id);
      mutation.mutate({
        path: id ? `/roles/${id}` : "/roles",
        method: id ? "PATCH" : "POST",
        body: form,
      });
    }
  };
  const filtered = (rows: Row[]) => {
    const term = filter.trim().toLowerCase();
    return term
      ? rows.filter((row) =>
          Object.values(row).some((value) =>
            text(value).toLowerCase().includes(term),
          ),
        )
      : rows;
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View
          style={{
            minHeight: 48,
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
            paddingHorizontal: spacing.md,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radii.sm,
            backgroundColor: colors.surface,
          }}
        >
          <Ionicons name="search" size={19} color={colors.textMuted} />
          <TextInput
            placeholder={`Search ${area}`}
            placeholderTextColor={colors.textMuted}
            value={filter}
            onChangeText={setFilter}
            style={{ ...type.body, flex: 1, color: colors.text }}
          />
        </View>
        {canManage ? (
          <Pressable
            onPress={() => (area === "users" ? setInvite(true) : openRole())}
            style={{
              width: 48,
              height: 48,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radii.sm,
              backgroundColor: colors.primary,
            }}
          >
            <Ionicons name="add" size={24} color={colors.inverse} />
          </Pressable>
        ) : null}
      </View>

      <Text style={{ ...type.heading, color: colors.text }}>
        {area === "users" ? "Organisation members" : "Organisation roles"}
      </Text>
      {filtered(
        area === "users" ? users : (data.roles as Row[] | undefined) || [],
      ).map((row) => (
        <View
          key={text(row.user_id || row.id)}
          style={{
            padding: spacing.md,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radii.md,
            backgroundColor: colors.surface,
            gap: spacing.sm,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: spacing.sm,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.label, color: colors.text }}>
                {text(row.full_name || row.name)}
              </Text>
              <Text style={{ ...type.caption, color: colors.textMuted }}>
                {text(row.email || row.slug)}
              </Text>
            </View>
            {row.status ? (
              <StatusPill value={text(row.status)} />
            ) : row.is_system ? (
              <StatusPill value="system" />
            ) : null}
          </View>
          <Text style={{ ...type.caption, color: colors.textSecondary }}>
            {area === "users"
              ? values(row.role_names).join(" + ") || "No role"
              : `${text(row.user_count || 0)} users · ${values(row.permission_keys).length} permissions`}
          </Text>
          {canManage && (area === "users" || Boolean(row.can_manage)) ? (
            <Pressable
              onPress={() => (area === "users" ? openUser(row) : openRole(row))}
              style={{
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radii.sm,
              }}
            >
              <Text style={{ ...type.label, color: colors.primary }}>
                {area === "users" ? "Edit access" : "Edit custom role"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {area === "users" ? (
        <>
          <Text style={{ ...type.heading, color: colors.text }}>
            Invitations
          </Text>
          {filtered(invitations).map((row) => (
            <View
              key={text(row.id)}
              style={{
                padding: spacing.md,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radii.md,
                backgroundColor: colors.surface,
                gap: spacing.sm,
              }}
            >
              <Text style={{ ...type.label, color: colors.text }}>
                {text(row.email)}
              </Text>
              <Text style={{ ...type.caption, color: colors.textMuted }}>
                {values(row.role_names).join(" + ")} · expires{" "}
                {text(row.expires_at)}
              </Text>
              {!row.accepted_at && !row.revoked_at && canManage ? (
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Button
                    style={{ flex: 1 }}
                    label="Resend"
                    variant="secondary"
                    onPress={() =>
                      mutation.mutate({
                        path: `/invitations/${text(row.id)}`,
                        method: "PATCH",
                        body: { action: "resend" },
                      })
                    }
                  />
                  <Button
                    style={{ flex: 1 }}
                    label="Revoke"
                    variant="quiet"
                    onPress={() =>
                      mutation.mutate({
                        path: `/invitations/${text(row.id)}`,
                        method: "PATCH",
                        body: { action: "revoke" },
                      })
                    }
                  />
                </View>
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      <Modal
        visible={Boolean(editing)}
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: spacing.md,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ ...type.heading, flex: 1, color: colors.text }}>
              {area === "users"
                ? "Edit user access"
                : editing?.id
                  ? "Edit role"
                  : "Create role"}
            </Text>
            <Pressable onPress={() => setEditing(null)}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
          >
            {area === "users" ? (
              <>
                <ChoiceList
                  title="Roles"
                  options={roles}
                  selected={values(form.roleIds)}
                  multiple
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      roleIds: value,
                      primaryRoleId: value.includes(text(current.primaryRoleId))
                        ? current.primaryRoleId
                        : value[0] || "",
                    }))
                  }
                />
                <ChoiceList
                  title="Primary role"
                  options={roles.filter((role) =>
                    values(form.roleIds).includes(role.id),
                  )}
                  selected={[text(form.primaryRoleId)]}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      primaryRoleId: value[0] || "",
                    }))
                  }
                />
                <ChoiceList
                  title="Status"
                  options={[
                    { id: "active", name: "Active" },
                    { id: "disabled", name: "Disabled" },
                  ]}
                  selected={[text(form.status || "active")]}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      status: value[0] || "active",
                    }))
                  }
                />
                <ChoiceList
                  title="Company access"
                  options={options.companies || []}
                  selected={values(form.companyIds)}
                  multiple
                  onChange={(value) =>
                    setForm((current) => ({ ...current, companyIds: value }))
                  }
                />
                <ChoiceList
                  title="Branch access"
                  options={options.branches || []}
                  selected={values(form.branchIds)}
                  multiple
                  onChange={(value) =>
                    setForm((current) => ({ ...current, branchIds: value }))
                  }
                />
                <ChoiceList
                  title="Department access"
                  options={options.departments || []}
                  selected={values(form.departmentIds)}
                  multiple
                  onChange={(value) =>
                    setForm((current) => ({ ...current, departmentIds: value }))
                  }
                />
                <ChoiceList
                  title="Team access"
                  options={options.teams || []}
                  selected={values(form.teamIds)}
                  multiple
                  onChange={(value) =>
                    setForm((current) => ({ ...current, teamIds: value }))
                  }
                />
                <ChoiceList
                  title="Warning-level access conflicts reviewed"
                  options={[
                    { id: "false", name: "No" },
                    { id: "true", name: "Yes, reviewed and approved" },
                  ]}
                  selected={[String(Boolean(form.acknowledgeWarningConflicts))]}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      acknowledgeWarningConflicts: value[0] === "true",
                    }))
                  }
                />
                <View style={{ gap: 5 }}>
                  <Text
                    style={{ ...type.caption, color: colors.textSecondary }}
                  >
                    Reason
                  </Text>
                  <TextInput
                    multiline
                    value={text(form.reason)}
                    onChangeText={(value) =>
                      setForm((current) => ({ ...current, reason: value }))
                    }
                    style={{
                      ...type.body,
                      minHeight: 92,
                      padding: spacing.md,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radii.sm,
                      color: colors.text,
                    }}
                  />
                </View>
              </>
            ) : (
              <>
                {(["name", "slug", "description"] as const).map((key) => (
                  <View key={key} style={{ gap: 5 }}>
                    <Text
                      style={{ ...type.caption, color: colors.textSecondary }}
                    >
                      {key === "slug"
                        ? "Slug (lowercase and underscores)"
                        : key.replace(/^./, (letter) => letter.toUpperCase())}
                    </Text>
                    <TextInput
                      multiline={key === "description"}
                      value={text(form[key])}
                      onChangeText={(value) =>
                        setForm((current) => ({ ...current, [key]: value }))
                      }
                      style={{
                        ...type.body,
                        minHeight: key === "description" ? 92 : 48,
                        padding: spacing.md,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radii.sm,
                        color: colors.text,
                      }}
                    />
                  </View>
                ))}
                <ChoiceList
                  title="Module"
                  options={[
                    { id: "platform", name: "Platform" },
                    { id: "crm", name: "CRM" },
                    { id: "sales", name: "Sales" },
                    { id: "accounting", name: "Accounting" },
                    { id: "procurement", name: "Procurement" },
                  ]}
                  selected={[text(form.moduleKey || "platform")]}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      moduleKey: value[0] || "platform",
                    }))
                  }
                />
                <ChoiceList
                  title="Risk level"
                  options={[
                    { id: "standard", name: "Standard" },
                    { id: "sensitive", name: "Sensitive" },
                    { id: "privileged", name: "Privileged" },
                  ]}
                  selected={[text(form.riskLevel || "standard")]}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      riskLevel: value[0] || "standard",
                    }))
                  }
                />
                <ChoiceList
                  title="Permissions"
                  options={permissions}
                  selected={values(form.permissionKeys)}
                  multiple
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      permissionKeys: value,
                    }))
                  }
                />
                <ChoiceList
                  title="Warning-level access conflicts reviewed"
                  options={[
                    { id: "false", name: "No" },
                    { id: "true", name: "Yes, reviewed and approved" },
                  ]}
                  selected={[String(Boolean(form.acknowledgeWarningConflicts))]}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      acknowledgeWarningConflicts: value[0] === "true",
                    }))
                  }
                />
              </>
            )}
            <Button
              label={mutation.isPending ? "Saving…" : "Save changes"}
              disabled={mutation.isPending}
              onPress={submit}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={invite}
        animationType="slide"
        onRequestClose={() => setInvite(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: spacing.md,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ ...type.heading, flex: 1, color: colors.text }}>
              Invite team member
            </Text>
            <Pressable onPress={() => setInvite(false)}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
          >
            <View style={{ gap: 5 }}>
              <Text style={{ ...type.caption, color: colors.textSecondary }}>
                Work email
              </Text>
              <TextInput
                keyboardType="email-address"
                autoCapitalize="none"
                value={inviteEmail}
                onChangeText={setInviteEmail}
                style={{
                  ...type.body,
                  minHeight: 48,
                  paddingHorizontal: spacing.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radii.sm,
                  color: colors.text,
                }}
              />
            </View>
            <ChoiceList
              title="Roles"
              options={roles}
              selected={inviteRoles}
              multiple
              onChange={(value) => {
                setInviteRoles(value);
                if (!value.includes(invitePrimaryRole)) {
                  setInvitePrimaryRole(value[0] || "");
                }
              }}
            />
            <ChoiceList
              title="Primary role"
              options={roles.filter((role) => inviteRoles.includes(role.id))}
              selected={[invitePrimaryRole]}
              onChange={(value) => setInvitePrimaryRole(value[0] || "")}
            />
            <ChoiceList
              title="Warning-level access conflicts reviewed"
              options={[
                { id: "false", name: "No" },
                { id: "true", name: "Yes, reviewed and approved" },
              ]}
              selected={[String(inviteWarningReviewed)]}
              onChange={(value) =>
                setInviteWarningReviewed(value[0] === "true")
              }
            />
            <Button
              label={mutation.isPending ? "Sending…" : "Send invitation"}
              disabled={
                mutation.isPending ||
                !inviteEmail ||
                !inviteRoles.length ||
                !invitePrimaryRole
              }
              onPress={() =>
                mutation.mutate({
                  path: "/invitations",
                  method: "POST",
                  body: {
                    email: inviteEmail,
                    roleIds: inviteRoles,
                    primaryRoleId: invitePrimaryRole,
                    companyIds: [],
                    branchIds: [],
                    departmentIds: [],
                    teamIds: [],
                    accessStartsAt: null,
                    accessExpiresAt: null,
                    acknowledgeWarningConflicts: inviteWarningReviewed,
                  },
                })
              }
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
