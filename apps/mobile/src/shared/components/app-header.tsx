import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, usePathname, type Href } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { mobileApi } from "@/core/api/client";
import { useAuth } from "@/core/auth/auth-provider";
import {
  accountNavigation,
  administrationNavigation,
  visibleDestinations,
  workspaceNavigation,
  type WorkspaceDestination,
} from "@/core/modules/navigation";
import { useTheme } from "@/shared/theme/theme";
import { minimumTouchTarget } from "@/shared/theme/tokens";
import { BrandMark } from "./brand-mark";

type ContextPicker = "organization" | "company" | "branch" | null;

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function destinationIsActive(pathname: string, key: string) {
  const path = pathname.replace(/\/$/, "") || "/";
  if (key === "dashboard") return path === "/" || path === "/index";
  if (key === "crm") {
    return (
      path === "/leads" ||
      path === "/pipeline" ||
      path.startsWith("/crm") ||
      path.startsWith("/workspace/crm")
    );
  }
  if (key === "master-data") return path.startsWith("/workspace/master-data");
  if (key === "notifications") return path === "/notifications";
  if (key === "profile") return path === "/workspace/profile";
  if (key === "security") return path === "/workspace/security";
  return path === `/workspace/${key}` || path.startsWith(`/workspace/settings/${key}`);
}

export function AppHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { colors, radii, spacing, type } = useTheme();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [picker, setPicker] = useState<ContextPicker>(null);
  const [changingContext, setChangingContext] = useState(false);
  const session = auth.session;
  const permissions = session?.access.permissions ?? [];
  const workspace = useQuery({
    queryKey: ["workspace-shell", session?.user.id],
    queryFn: () => mobileApi.workspace(),
    enabled: Boolean(session),
    staleTime: 30_000,
  });
  const shell = workspace.data?.shell;
  const organizations = shell?.organizations ?? [];
  const companies = shell?.companies ?? [];
  const branches = (shell?.branches ?? []).filter(
    (branch) => branch.company_id === session?.workspace.activeCompanyId,
  );

  if (!session) return null;

  const navigate = (href: Href) => {
    setMenuOpen(false);
    router.push(href);
  };

  const changeContext = async (id: string | null) => {
    if (!id && picker !== "branch") return;

    setChangingContext(true);
    try {
      const result =
        picker === "organization"
          ? await mobileApi.setWorkspaceOrganization({
              organizationId: String(id),
            })
          : await mobileApi.setWorkspaceContext({
              companyId:
                picker === "company"
                  ? String(id)
                  : String(session.workspace.activeCompanyId),
              branchId:
                picker === "branch"
                  ? id
                  : (shell?.branches ?? []).some(
                        (branch) =>
                          branch.id === session.workspace.activeBranchId &&
                          branch.company_id === id,
                      )
                    ? session.workspace.activeBranchId
                    : null,
            });

      await auth.applySession(result.session);
      queryClient.setQueryData(
        ["workspace-shell", result.session.user.id],
        result,
      );
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "workspace-shell",
      });
      setPicker(null);
    } catch (error) {
      Alert.alert(
        "Context not changed",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setChangingContext(false);
    }
  };

  const menuSection = (
    label: string,
    items: readonly WorkspaceDestination[],
  ) => (
    <View style={{ gap: 4 }}>
      <Text
        style={{
          ...type.caption,
          paddingHorizontal: spacing.sm,
          paddingTop: spacing.sm,
          color: colors.textMuted,
          fontSize: 10,
          fontWeight: "800",
          letterSpacing: 1.1,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      {visibleDestinations(items, permissions).map((item) => {
        const active = destinationIsActive(pathname, item.key);
        return (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => navigate(item.href)}
            style={({ pressed }) => ({
              position: "relative",
              minHeight: minimumTouchTarget,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              overflow: "hidden",
              paddingHorizontal: spacing.sm,
              borderWidth: 1,
              borderColor: active ? "#C7D2FE" : "transparent",
              borderRadius: radii.sm,
              backgroundColor:
                active || pressed ? colors.primarySoft : "transparent",
            })}
          >
            {active ? (
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: 3,
                  backgroundColor: colors.primary,
                }}
              />
            ) : null}
            <View
              style={{
                width: 31,
                height: 31,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name={item.icon}
                size={19}
                color={active ? colors.primary : colors.textMuted}
              />
            </View>
            <Text
              style={{
                flex: 1,
                color: active ? colors.primaryPressed : colors.textSecondary,
                fontSize: 13,
                fontWeight: "700",
              }}
            >
              {item.label}
            </Text>
            {item.key === "notifications" && shell?.unreadNotifications ? (
              <View
                style={{
                  minWidth: 22,
                  height: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 5,
                  borderRadius: 11,
                  backgroundColor: colors.danger,
                }}
              >
                <Text style={{ color: colors.inverse, fontSize: 9, fontWeight: "800" }}>
                  {shell.unreadNotifications > 99 ? "99+" : shell.unreadNotifications}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={{ gap: spacing.md, marginBottom: spacing.xl }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open navigation menu"
          onPress={() => setMenuOpen(true)}
          style={{
            width: minimumTouchTarget,
            height: minimumTouchTarget,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: menuOpen ? 2 : 1,
            borderColor: menuOpen ? colors.primary : colors.border,
            borderRadius: 11,
            backgroundColor: colors.surface,
            shadowColor: menuOpen ? colors.primary : "transparent",
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: menuOpen ? 0.18 : 0,
            shadowRadius: 4,
            elevation: menuOpen ? 2 : 0,
          }}
        >
          <Ionicons name="menu" size={23} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search workspace"
          onPress={() => router.push("/(protected)/search")}
          style={{
            minHeight: minimumTouchTarget,
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
            paddingHorizontal: spacing.sm,
            borderRadius: 11,
            backgroundColor: "#F2F4F7",
          }}
        >
          <Ionicons name="search" size={19} color={colors.textMuted} />
          <Text numberOfLines={1} style={{ ...type.caption, flex: 1, color: colors.textMuted }}>
            Search partners, items, companies, branches or users
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${shell?.unreadNotifications ?? 0} unread notifications`}
          onPress={() => router.push("/(protected)/notifications")}
          style={{
            width: minimumTouchTarget,
            height: minimumTouchTarget,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 11,
          }}
        >
          <Ionicons name="notifications-outline" size={21} color={colors.textSecondary} />
          {shell?.unreadNotifications ? (
            <View
              style={{
                position: "absolute",
                top: 4,
                right: 3,
                minWidth: 17,
                height: 17,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 3,
                borderWidth: 2,
                borderColor: colors.surface,
                borderRadius: 9,
                backgroundColor: colors.danger,
              }}
            >
              <Text style={{ color: colors.inverse, fontSize: 7, fontWeight: "800" }}>
                {shell.unreadNotifications > 99 ? "99+" : shell.unreadNotifications}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          onPress={() => router.push("/(protected)/workspace/profile")}
          style={{
            width: 40,
            height: 40,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 11,
            backgroundColor: colors.primary,
          }}
        >
          <Text style={{ color: colors.inverse, fontSize: 11, fontWeight: "900" }}>
            {initials(session.user.fullName)}
          </Text>
        </Pressable>
      </View>

      <View
        style={{
          minHeight: 54,
          flexDirection: "row",
          alignItems: "center",
          padding: 6,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          backgroundColor: colors.surface,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 9,
            backgroundColor: colors.primarySoft,
          }}
        >
          <Ionicons name="business-outline" size={18} color={colors.primary} />
        </View>
        <Pressable
          onPress={() =>
            organizations.length > 1 && setPicker("organization")
          }
          style={{ flex: 1, paddingHorizontal: spacing.xs }}
        >
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 8,
              fontWeight: "800",
              letterSpacing: 0.7,
            }}
          >
            ORGANISATION
          </Text>
          <Text
            numberOfLines={1}
            style={{
              color: colors.textSecondary,
              fontSize: 11,
              fontWeight: "700",
            }}
          >
            {session.workspace.organizationName || "Not selected"}
          </Text>
        </Pressable>
        <View style={{ width: 1, height: 28, backgroundColor: colors.border }} />
        <Pressable
          onPress={() => companies.length > 1 && setPicker("company")}
          style={{ flex: 1, paddingHorizontal: spacing.xs }}
        >
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 8,
              fontWeight: "800",
              letterSpacing: 0.7,
            }}
          >
            COMPANY
          </Text>
          <Text
            numberOfLines={1}
            style={{
              color: colors.textSecondary,
              fontSize: 11,
              fontWeight: "700",
            }}
          >
            {session.workspace.companyName || "Not selected"}
          </Text>
        </Pressable>
        <View style={{ width: 1, height: 28, backgroundColor: colors.border }} />
        <Pressable
          onPress={() => setPicker("branch")}
          style={{ flex: 1, paddingHorizontal: spacing.xs }}
        >
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 8,
              fontWeight: "800",
              letterSpacing: 0.7,
            }}
          >
            BRANCH
          </Text>
          <Text
            numberOfLines={1}
            style={{
              color: colors.textSecondary,
              fontSize: 11,
              fontWeight: "700",
            }}
          >
            {session.workspace.branchName || "All branches"}
          </Text>
        </Pressable>
      </View>

      <Text style={{ color: colors.textMuted, fontSize: 11 }}>
        Dashboard <Text style={{ color: "#C0C7D2" }}>›</Text>{" "}
        <Text style={{ color: colors.textSecondary, fontWeight: "700" }}>{title}</Text>
      </Text>
      <View style={{ gap: spacing.xs }}>
        {eyebrow ? (
          <Text
            style={{
              color: colors.primary,
              fontSize: 11,
              fontWeight: "800",
              letterSpacing: 1.1,
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </Text>
        ) : null}
        <Text accessibilityRole="header" style={{ ...type.display, color: colors.text, fontSize: 32 }}>
          {title}
        </Text>
        {description ? (
          <Text style={{ ...type.caption, color: colors.textMuted }}>{description}</Text>
        ) : null}
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setMenuOpen(false)}>
        <View style={{ flex: 1 }}>
          <Pressable
            accessibilityLabel="Close navigation menu"
            onPress={() => setMenuOpen(false)}
            style={{ position: "absolute", inset: 0 }}
          />
            <Pressable
              onPress={(event) => event.stopPropagation()}
              style={{
                position: "absolute",
                top: insets.top + 68,
                left: 12,
                width: Math.min(360, window.width - 24),
                maxHeight: Math.max(240, window.height - insets.top - 82),
                overflow: "hidden",
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 18,
                backgroundColor: colors.surface,
                shadowColor: "#101828",
                shadowOffset: { width: 0, height: 24 },
                shadowOpacity: 0.14,
                shadowRadius: 32,
                elevation: 18,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.sm,
                  paddingHorizontal: 7,
                  paddingTop: 6,
                  paddingBottom: spacing.sm,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <BrandMark size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.label, color: colors.text }}>Vercent ERP</Text>
                  <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>
                    {session.workspace.organizationName}
                  </Text>
                </View>
              </View>
              <ScrollView contentContainerStyle={{ padding: spacing.sm, gap: spacing.xs }}>
                {menuSection("Workspace", workspaceNavigation)}
                {menuSection("Administration", administrationNavigation)}
                {menuSection("Account", accountNavigation)}
                <Pressable
                  onPress={auth.signOut}
                  style={{
                    minHeight: minimumTouchTarget,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                    marginTop: spacing.xs,
                    paddingHorizontal: spacing.sm,
                    borderRadius: radii.sm,
                    backgroundColor: colors.dangerSoft,
                  }}
                >
                  <Ionicons name="log-out-outline" size={20} color={colors.danger} />
                  <Text style={{ ...type.label, color: colors.danger }}>Sign out</Text>
                </Pressable>
              </ScrollView>
            </Pressable>
        </View>
      </Modal>

      <Modal visible={Boolean(picker)} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <SafeAreaView style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(11,18,32,0.34)" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setPicker(null)} />
          <View
            style={{
              maxHeight: "66%",
              padding: spacing.lg,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              backgroundColor: colors.surface,
              gap: spacing.sm,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.heading, color: colors.text }}>
                  Select{" "}
                  {picker === "organization"
                    ? "organisation"
                    : picker === "company"
                      ? "company"
                      : "branch"}
                </Text>
                <Text style={{ ...type.caption, color: colors.textMuted }}>
                  This changes the operating scope across the workspace.
                </Text>
              </View>
              {changingContext ? <ActivityIndicator color={colors.primary} /> : null}
            </View>
            <ScrollView>
              {picker === "branch" ? (
                <Pressable
                  disabled={changingContext}
                  onPress={() => changeContext(null)}
                  style={{ minHeight: 52, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.border }}
                >
                  <Text style={{ ...type.label, color: colors.text }}>All branches</Text>
                </Pressable>
              ) : null}
              {(picker === "organization"
                ? organizations
                : picker === "company"
                  ? companies
                  : branches
              ).map((option) => (
                <Pressable
                  key={option.id}
                  disabled={changingContext}
                  onPress={() => changeContext(option.id)}
                  style={{ minHeight: 52, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border }}
                >
                  <Text style={{ ...type.label, flex: 1, color: colors.text }}>{option.name}</Text>
                  {(picker === "organization"
                    ? session.workspace.organizationId
                    : picker === "company"
                      ? session.workspace.activeCompanyId
                      : session.workspace.activeBranchId) === option.id ? (
                    <Ionicons name="checkmark-circle" size={21} color={colors.primary} />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
