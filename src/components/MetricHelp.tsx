// 指标说明入口：报告里所有"?"统一走弹框，不用 tooltip（移动端没有悬停态）
import { CircleHelp } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function MetricHelp({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`查看「${title}」说明`}
          className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center justify-center rounded-full p-0.5 align-middle transition-colors"
        >
          <CircleHelp className="size-4" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">指标含义、计算方式与解读建议</DialogDescription>
        </DialogHeader>
        <div className="text-muted-foreground flex flex-col gap-2 text-sm">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
