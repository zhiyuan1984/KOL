import { forwardRef } from "react";
import { Input, type InputProps, type InputRef } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { TaskTheme } from "../tasks/TaskTheme";
import "./workspace-search-input.css";

export type WorkspaceSearchInputProps = Omit<InputProps, "allowClear" | "prefix" | "type">;

/**
 * Shared compact search control. It preserves Ant Design's native change-event
 * contract while insulating the actual input element from legacy native-input CSS.
 */
const WorkspaceSearchInput = forwardRef<InputRef, WorkspaceSearchInputProps>(function WorkspaceSearchInput(
  { className, ...props },
  ref,
) {
  const rootClassName = ["workspace-search-input", className].filter(Boolean).join(" ");

  return (
    <TaskTheme>
      <Input
        {...props}
        ref={ref}
        className={rootClassName}
        classNames={className ? { input: className } : undefined}
        type="text"
        prefix={<SearchOutlined aria-hidden="true" />}
        allowClear
      />
    </TaskTheme>
  );
});

WorkspaceSearchInput.displayName = "WorkspaceSearchInput";

export default WorkspaceSearchInput;
