import FavouritesList from "@/components/favourites-list";
import { requireWorkspace } from "@/lib/auth";
import { listFavourites } from "@/lib/favourites";

export const metadata = { title: "Favourites" };
export const dynamic = "force-dynamic";

export default async function FavouritesPage() {
  const session = await requireWorkspace();
  const favourites = await listFavourites(session, 100);

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Saved by you</p>
          <h1>Favourites</h1>
          <p>
            Records and pages you&apos;ve pinned for quick access. Access is
            re-checked every time this list loads — a favourite never grants
            more than you already have.
          </p>
        </div>
      </section>
      <FavouritesList favourites={favourites} />
    </>
  );
}
