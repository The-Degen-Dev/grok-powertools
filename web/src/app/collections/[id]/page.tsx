import CollectionView from "@/components/collections/CollectionView";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CollectionView collectionId={id} />;
}
