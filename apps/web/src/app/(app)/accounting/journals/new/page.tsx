import { getAccountingOptions } from "@vercentlabs/api";
import JournalEditor from "@/components/accounting/journal-editor";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { accountingContext } from "@/lib/accounting";
import { tenantTransaction } from "@/lib/db";
export const dynamic = "force-dynamic";
type Option = { id:string; code?:string; name?:string; display_name?:string; functional_currency_code?:string; ledger_id?:string; is_group?:boolean; allow_manual_posting?:boolean };
export default async function NewJournalPage(){const session=await requireWorkspace();if(!hasPermission(session,PERMISSIONS.accountingJournalCreate))return <section className="panel"><h1>Journal creation permission required</h1></section>;if(!session.activeCompanyId)return <section className="panel"><h1>Select a company first</h1></section>;const context=accountingContext(session);const data=await tenantTransaction(context.organizationId,(client)=>getAccountingOptions(client,context,session.activeCompanyId)) as unknown as {company:{id:string;base_currency:string};ledgers:Option[];journals:Option[];accounts:Option[];parties:Option[];branches:Option[];departments:Option[];costCenters:Option[]};return <><section className="page-heading"><div><p className="eyebrow">General ledger</p><h1>New journal entry</h1><p>Create a balanced double-entry draft. Submission, approval and posting remain separate governed actions.</p></div></section><JournalEditor companyId={data.company.id} baseCurrency={data.company.base_currency} ledgers={data.ledgers} journals={data.journals} accounts={data.accounts} parties={data.parties} branches={data.branches} departments={data.departments} costCenters={data.costCenters}/></>}
