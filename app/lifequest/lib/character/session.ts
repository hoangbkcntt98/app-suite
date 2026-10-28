import { cookies } from "next/headers";
import { prisma } from "@lifequest/lib/prisma";

export const CHARACTER_COOKIE = "lifequest_character_id";

export async function getSelectedCharacter(userId: string) {
  const cookieStore = await cookies();
  const characterId = cookieStore.get(CHARACTER_COOKIE)?.value;

  if (!characterId) return null;

  return prisma.character.findFirst({
    where: {
      id: characterId,
      userId,
    },
  });
}

export async function getUserCharacterCount(userId: string) {
  return prisma.character.count({
    where: {
      userId,
    },
  });
}
