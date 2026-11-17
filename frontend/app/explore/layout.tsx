// Only here to give /explore its <title> (the page is a client component). The
// template is the root layout's again: a plain title here would drop it for
// every page under /explore.

export const metadata = { title: { default: "Explore", template: "%s · SmartDrugDiscovery" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
