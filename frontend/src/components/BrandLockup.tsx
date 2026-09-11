export default function BrandLockup({ variant = "home" }: { variant?: "home" }) {
  return (
    <div className={"brand-lockup brand-lockup--" + variant} data-brand-lockup={variant}>
      <img className="brand-logo" src="/brand/litime-logo.png" alt="LiTime LIFE & DISCOVERY" />
      <div className="brand-slogans">
        <p className="brand-slogan-en">Powering Outdoor Adventures for Generations!</p>
        <p className="brand-slogan-zh">服务几代人的户外生活</p>
      </div>
    </div>
  );
}
