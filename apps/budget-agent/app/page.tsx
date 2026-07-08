import { Card } from "@heroui/react";

export default function Home() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-8">
      <Card className="w-full max-w-xl">
        <Card.Header>
          <Card.Title>Milwaukee Budget — Journalist</Card.Title>
          <Card.Description>
            Reconciled City &amp; County budget data, agent access layer.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <p className="text-sm text-muted">
            Scaffold running. No live data wired up yet.
          </p>
        </Card.Content>
      </Card>
    </div>
  );
}
