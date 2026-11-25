import { z } from 'zod';

export const CLUB_RADIUS_METERS = 100;
export const attendancePosition = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(50),
  measuredAt: z.number().int().positive(),
});
export type AttendancePosition = z.infer<typeof attendancePosition>;
export const scanInput = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('club'), ticket:z.string().regex(/^\d{16}$/), position:attendancePosition}),
  z.object({kind:z.literal('program'), code:z.string().regex(/^\d{4}$/)}),
]);
export type AttendanceScan = z.infer<typeof scanInput>;
export function freshPosition(point: AttendancePosition, now=Date.now()) {
  const age=now-point.measuredAt;
  return attendancePosition.safeParse(point).success && age>=-5000 && age<=60_000;
}
export function distanceMeters(a:AttendancePosition,b:AttendancePosition) {
  const rad=Math.PI/180;
  const h=Math.sin((b.latitude-a.latitude)*rad/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((b.longitude-a.longitude)*rad/2)**2;
  return 2*6371000*Math.asin(Math.sqrt(Math.min(1,h)));
}
