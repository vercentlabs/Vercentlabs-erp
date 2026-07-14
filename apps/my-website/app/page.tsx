import Image from 'next/image'
 
export default function Page() {
  return <>
  <Image src="/file.svg" alt="Profile" width={100} height={100} />
  <h1>Hello, Next.js!</h1>
  </>
}

