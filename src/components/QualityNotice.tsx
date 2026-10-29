// 录音质量提醒：数据本身不可靠时，先让用户知道，而不是给一个误导性的低分
import { useMemo } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { assessRecording } from '@/audio/quality';
import type { PcmData } from '@/analysis/types';

export function QualityNotice({ pcm }: { pcm: PcmData }) {
  const quality = useMemo(() => assessRecording(pcm), [pcm]);
  if (quality.issues.length === 0) return null;
  return (
    <Card className="border-amber-500/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TriangleAlert className="size-4 text-amber-500" />
          录音质量提示
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
          {quality.issues.map((issue) => (
            <li key={issue}>· {issue}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
