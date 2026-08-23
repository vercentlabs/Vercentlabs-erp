import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ResourceManager from "@/shared/components/resource-manager";
import { requireWorkspace } from "@/core/auth";
import { hasPermission } from "@/core/authorization";
import {
  isResourceKey,
  listResource,
  resourceDefinitions,
  resourceOptions,
} from "@/core/resources";

export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ resource: string }>;
}): Promise<Metadata> {
  const { resource } = await params;
  return {
    title: isResourceKey(resource)
      ? resourceDefinitions[resource].title
      : "Settings",
  };
}

export default async function ResourceSettingsPage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const { resource } = await params;
  if (!isResourceKey(resource)) notFound();
  const session = await requireWorkspace();
  const definition = resourceDefinitions[resource];
  if (!hasPermission(session, definition.permission)) notFound();
  const [rows, options] = await Promise.all([
    listResource(resource, session.organizationId as string),
    resourceOptions(session.organizationId as string),
  ]);
  const canManage = hasPermission(session, definition.permission);
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">{definition.eyebrow}</p>
          <h1>{definition.title}</h1>
          <p>{definition.description}</p>
        </div>
        {canManage ? (
          <span className="status-badge">Manage access</span>
        ) : (
          <span className="status-badge neutral">Read only</span>
        )}
      </section>
      <ResourceManager
        resource={resource}
        fields={definition.fields}
        rows={
          JSON.parse(JSON.stringify(rows)) as Array<Record<string, unknown>>
        }
        options={options}
        canManage={canManage}
      />
    </>
  );
}
