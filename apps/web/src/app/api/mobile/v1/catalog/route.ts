import { getBusinessDataOverview } from "@vercent/api";

import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import {
  businessDataContext,
  businessDataDefinitions,
  businessDataGroups,
} from "@/lib/business-data";
import { canViewCrmResource } from "@/lib/crm-api";
import { crmDefinitions } from "@/lib/crm";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";
import { moduleCatalog } from "@/lib/platform";
import { resourceDefinitions } from "@/lib/resources";
import { tenantTransaction } from "@/lib/db";

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
