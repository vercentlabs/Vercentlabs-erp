import { redirect } from "next/navigation";

// Where signing in, setting up a workspace and joining a team land: always the home page (the app launcher), keeping the
// "welcome back" flag when signup found an existing workspace.
export default async function StartPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  redirect((await searchParams).welcome === "back" ? "/?welcome=back" : "/");
}
