// Only here to give /explore/podcast its <title> without touching the page.

export const metadata = { title: "Podcast" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
