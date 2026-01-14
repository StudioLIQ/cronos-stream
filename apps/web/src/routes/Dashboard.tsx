import { useParams } from 'react-router-dom';

export default function Dashboard() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <div className="container">
      <h1>Dashboard - {slug}</h1>
      <p>Dashboard page will be implemented in T4.5</p>
    </div>
  );
}
