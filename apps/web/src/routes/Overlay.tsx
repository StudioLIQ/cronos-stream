import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { OverlayLayer } from '../components/OverlayLayer';

export default function Overlay() {
  const { slug } = useParams<{ slug: string }>();

  useEffect(() => {
    if (!slug) return;
    const prevHtmlBackground = document.documentElement.style.background;
    const prevBodyBackground = document.body.style.background;
    const prevBodyMargin = document.body.style.margin;

    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';

    return () => {
      document.documentElement.style.background = prevHtmlBackground;
      document.body.style.background = prevBodyBackground;
      document.body.style.margin = prevBodyMargin;
    };
  }, [slug]);

  if (!slug) return null;

  return (
    <OverlayLayer slug={slug} position="fixed" />
  );
}
