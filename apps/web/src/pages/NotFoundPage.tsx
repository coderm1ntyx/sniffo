import { PrimaryButton } from '../components/ui/PrimaryButton';
export function NotFoundPage() {
  return (
    <section className="not-found">
      <p className="eyebrow">404 · WRONG TURN</p>
      <h1>This page wandered off</h1>
      <PrimaryButton to="/">Back to Sniffo</PrimaryButton>
    </section>
  );
}
