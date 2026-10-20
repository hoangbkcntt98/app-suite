import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  const quotes = [
    {
      content: "Mỗi ngày tốt hơn 1% là đủ.",
      author: null,
      category: "discipline",
    },
    {
      content: "Kỷ luật là cây cầu giữa mục tiêu và kết quả.",
      author: null,
      category: "discipline",
    },
    {
      content: "Đừng chờ có động lực rồi mới làm. Hãy làm để tạo ra động lực.",
      author: null,
      category: "motivation",
    },
    {
      content: "Một nhiệm vụ nhỏ hôm nay tốt hơn một kế hoạch hoàn hảo ngày mai.",
      author: null,
      category: "action",
    },
    {
      content: "Bạn không cần giỏi ngay từ đầu, bạn chỉ cần bắt đầu.",
      author: null,
      category: "beginner",
    },
    {
      content: "Thói quen nhỏ tạo nên thay đổi lớn.",
      author: null,
      category: "habit",
    },
    {
      content: "Nếu hôm nay mệt, hãy làm phiên bản nhỏ nhất của nhiệm vụ.",
      author: null,
      category: "comeback",
    },
    {
      content: "Không bỏ cuộc cũng là một loại tài năng.",
      author: null,
      category: "discipline",
    },
    {
      content: "Tiến bộ chậm vẫn là tiến bộ.",
      author: null,
      category: "growth",
    },
    {
      content: "Bạn đang xây dựng tương lai bằng những việc nhỏ hôm nay.",
      author: null,
      category: "growth",
    },
  ];

  for (const quote of quotes) {
    await prisma.dailyQuote.create({
      data: quote,
    });
  }


  // Default attributes with multipliers for cultivation theme
  const defaultAttributes = [
    { name: "Strength", icon: "💪", multiplier: 1.2, color: "#ef4444" },
    { name: "Intelligence", icon: "🧠", multiplier: 1.5, color: "#3b82f6" },
    { name: "Discipline", icon: "🛡️", multiplier: 1.0, color: "#10b981" },
    { name: "Creativity", icon: "🎨", multiplier: 1.3, color: "#f59e0b" },
    { name: "Wisdom", icon: "📚", multiplier: 1.8, color: "#8b5cf6" },
  ];

  console.log("Default attributes defined (will be created per user):", defaultAttributes);

 console.log("Seed quotes completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
