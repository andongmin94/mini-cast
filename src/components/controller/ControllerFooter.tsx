import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useUpdateNotice } from "@/components/controller/useUpdateNotice";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui-custom/alert-dialog";

interface ControllerFooterProps {
  version: string;
  onReset: () => void;
}

export default function ControllerFooter({
  version,
  onReset,
}: ControllerFooterProps) {
  const { status, release, message } = useUpdateNotice(version);

  const statusText = useMemo(() => {
    if (status === "idle") {
      return null;
    }
    if (status === "checking") {
      return "업데이트 확인 중...";
    }
    return message;
  }, [message, status]);

  return (
    <div className="pointer-events-auto mr-1 flex items-end justify-between gap-2 text-xs">
      <div className="flex items-center gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="mb-2 ml-2 h-6 w-10">
              리셋
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="mt-5 max-w-[355px] rounded-md p-4">
            <AlertDialogHeader>
              <AlertDialogTitle>정말로 리셋하시겠습니까?</AlertDialogTitle>
              <AlertDialogDescription>
                모든 설정이 초기화됩니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={onReset}>리셋</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {statusText && (
          <span
            className="text-muted-foreground max-w-[210px] truncate pb-2"
            title={statusText}
          >
            {statusText}
          </span>
        )}
        {status === "available" && release?.downloadUrl && (
          <Button asChild size="sm" className="mb-2 h-6 px-2 text-xs">
            <a
              href={release.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              다운로드
            </a>
          </Button>
        )}
      </div>
      <span className="pointer-events-none pb-2">v{version}</span>
    </div>
  );
}
