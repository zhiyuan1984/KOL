export default function BrandLockup({
  variant = "sidebar",
  showSlogans = false,
}: {
  variant?: "home" | "sidebar" | "dialog";
  showSlogans?: boolean;
}) {
  const slogans = showSlogans && variant !== "sidebar";
  return (
    <div className={"brand-lockup brand-lockup--" + variant} data-brand-lockup={variant}>
      <img className="brand-logo" src="/brand/litime-logo.png" alt="Li Time" />
      {slogans ? (
        <div className="brand-slogans">
          <p className="brand-mark" data-brand-mark>LIFE & DISCOVERY</p>
          <p className="brand-slogan-en">Powering Outdoor Adventures for Generations!</p>
          <p className="brand-slogan-zh">服务几代人的户外生活</p>
        </div>
      ) : null}
    </div>
  );
}
