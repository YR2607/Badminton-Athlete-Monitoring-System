/** Public URL of an athlete avatar stored in the `avatars` bucket. */
export function avatarPublicUrl(photoPath: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${photoPath}`;
}
