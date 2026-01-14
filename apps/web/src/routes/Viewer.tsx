import { useParams } from 'react-router-dom';

export default function Viewer() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <div className="container">
      <h1>Viewer - {slug}</h1>
      <p>Viewer page will be implemented in T4.3</p>
    </div>
  );
}
