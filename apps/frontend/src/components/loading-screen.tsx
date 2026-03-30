export function LoadingScreen({ label = 'Caricamento in corso...' }: { label?: string }) {
  return (
    <div className="loading-screen">
      <div className="loading-screen__dot" />
      <p>{label}</p>
    </div>
  );
}
