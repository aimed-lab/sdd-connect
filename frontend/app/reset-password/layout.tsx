// Only here to give the page its <title>: the page itself is a client component.

export const metadata = { title: { default: "Reset your password", template: "%s · SmartDrugDiscovery" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
