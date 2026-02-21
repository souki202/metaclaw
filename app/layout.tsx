import "./globals.css";

export const metadata = {
  title: "meta-claw",
  description: "Multi-session AI Personal Agent System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
