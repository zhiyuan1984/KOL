import { Button, type ButtonProps } from "antd";

type DataProps = { [key: `data-${string}`]: string | number | boolean | undefined };
export default function KolAction({ className = "", emphasized = false, ...props }: ButtonProps & DataProps & { emphasized?: boolean }) {
  return <Button {...props} htmlType="button" type="text" size="small" className={`kol-card-action ${className}`} data-emphasized={emphasized || undefined} />;
}
