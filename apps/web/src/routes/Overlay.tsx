import { useParams } from 'react-router-dom';

export default function Overlay() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <p style={{ position: 'absolute', top: 20, left: 20, color: 'rgba(255,255,255,0.3)' }}>
        Overlay - {slug}
      </p>
    </div>
  );
}
