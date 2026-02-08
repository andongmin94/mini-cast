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
import { Button } from "@/components/ui/button";

interface ControllerFooterProps {
  version: string;
  onReset: () => void;
}

export default function ControllerFooter({
  version,
  onReset,
}: ControllerFooterProps) {
  return (
    <div className="pointer-events-auto mr-1 flex items-end justify-between text-xs">
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
      v{version}
    </div>
  );
}
