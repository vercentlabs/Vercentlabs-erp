import { getBusinessDataOverview } from "@vercentlabs/api";

import { hasPermission, PERMISSIONS } from "@/core/authorization";
import {
  businessDataContext,
  businessDataDefinitions,
  businessDataGroups,
} from "@/core/master-data";
import { canViewCrmResource } from "@/modules/crm/api";
import { crmDefinitions } from "@/modules/crm";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { moduleCatalog } from "@/core/platform";
import { resourceDefinitions } from "@/core/resources";
import { tenantTransaction } from "@/core/db";

export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    const crm = hasPermission(session, PERMISSIONS.crmView)
      ? Object.values(crmDefinitions).filter((definition) =>
          canViewCrmResource(session, definition.key),
        )
      : [];
    const masterData = hasPermission(session, PERMISSIONS.businessDataView)
      ? Object.values(businessDataDefinitions)
      : [];
    const masterDataOverview = masterData.length && session.organizationId
      ? await tenantTransaction(session.organizationId, (client) =>
          getBusinessDataOverview(client, businessDataContext(session)),
        )
      : {};
    const settings = Object.entries(resourceDefinitions)
      .filter(([, definition]) => hasPermission(session, definition.permission))
      .map(([key, definition]) => ({ key, ...definition }));

    return mobileOk(request, {
      catalog: {
        crm,
        masterData,
        masterDataGroups: businessDataGroups,
        masterDataOverview,
        settings,
        modules: moduleCatalog,
      },
    });
  } catch (error) {
    return mobileError(request, error);
  }
}
