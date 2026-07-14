function generateStaticParams() {}
 
export default function Page() {
  return <h1>Hello, Blog Post Page!</h1>
}

// export default async function BlogPostPage({
//   params,
// }: {
//   params: Promise<{ slug: string }>
// }) {
//   const { slug } = await params
//   const post = await getPost(slug)
 
//   return (
//     <div>
//       <h1>{post.title}</h1>
//       <p>{post.content}</p>
//     </div>
//   )
// }