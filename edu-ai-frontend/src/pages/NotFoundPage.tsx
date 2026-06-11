import { useNavigate } from "react-router-dom";
import { motion, type Variants } from "motion/react";
import { Search } from "lucide-react";

export default function NotFoundPage() {
  const navigate = useNavigate();

  const staggerContainer = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.1,
      },
    },
  } satisfies Variants;

  const slideUpVariants = {
    hidden: { y: "120%", opacity: 0 },
    show: {
      y: "0%",
      opacity: 1,
      transition: {
        type: "spring",
        damping: 25,
        stiffness: 120,
      },
    },
  } satisfies Variants;

  const buttonIconVariants = {
    rest: { x: 0, scale: 1 },
    hover: {
      x: 5,
      scale: 1.1,
      transition: { type: "spring", stiffness: 400, damping: 10 },
    },
  } satisfies Variants;

  const pathVariants = {
    rest: { pathLength: 1, opacity: 1, strokeDashoffset: 0 },
    hover: {
      pathLength: [0, 1],
      opacity: [0, 1],
      transition: { duration: 0.6, ease: "easeInOut" },
    },
  } satisfies Variants;

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6 font-sans relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-100 rounded-full blur-[120px] mix-blend-multiply opacity-70"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-100 rounded-full blur-[120px] mix-blend-multiply opacity-70"></div>

      <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="flex flex-col items-center lg:items-start text-center lg:text-left order-2 lg:order-1"
        >
          <div className="overflow-hidden pb-2 mb-6">
            <motion.div
              variants={slideUpVariants}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 font-medium text-sm"
            >
              <Search className="w-4 h-4" />
              <span>404 知识盲区</span>
            </motion.div>
          </div>

          <div className="flex flex-col gap-2 mb-6">
            <div className="overflow-hidden pb-2">
              <motion.h1
                variants={slideUpVariants}
                className="text-6xl sm:text-7xl lg:text-8xl font-display font-bold text-gray-900 tracking-tight leading-tight"
              >
                哎呀，
              </motion.h1>
            </div>
            <div className="overflow-hidden pb-4">
              <motion.h1
                variants={slideUpVariants}
                className="text-6xl sm:text-7xl lg:text-8xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 tracking-tight leading-tight"
              >
                走错教室啦
              </motion.h1>
            </div>
          </div>

          <div className="flex flex-col gap-1 mb-10 text-lg sm:text-xl text-gray-600 max-w-xl font-light leading-relaxed">
            <div className="overflow-hidden pb-1">
              <motion.p variants={slideUpVariants}>
                别担心，漫漫求学路上难免会绕点远路。
              </motion.p>
            </div>
            <div className="overflow-hidden pb-1">
              <motion.p variants={slideUpVariants}>
                你寻找的课程资料可能已移至“进阶区”，
              </motion.p>
            </div>
            <div className="overflow-hidden pb-1">
              <motion.p variants={slideUpVariants}>
                或者这门课程正在闭关升级中。
              </motion.p>
            </div>
          </div>

          <div className="overflow-hidden pt-2 pb-4">
            <motion.a
              href="/"
              variants={slideUpVariants}
              whileHover="hover"
              initial="rest"
              animate="rest"
              onClick={(event) => {
                event.preventDefault();
                navigate("/");
              }}
              className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 bg-gray-900 text-white rounded-2xl font-medium overflow-hidden shadow-xl shadow-gray-900/20"
            >
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-purple-600"
                initial={{ x: "-100%" }}
                variants={{
                  hover: { x: "0%" },
                }}
                transition={{ type: "tween", ease: "easeInOut", duration: 0.3 }}
              />

              <span className="relative z-10">返回学习中心</span>

              <motion.svg
                variants={buttonIconVariants}
                className="relative z-10 w-6 h-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <motion.path variants={pathVariants} d="M5 12h14" />
                <motion.path variants={pathVariants} d="m12 5 7 7-7 7" />
              </motion.svg>
            </motion.a>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.5, ease: "easeOut" }}
          className="relative flex justify-center items-center order-1 lg:order-2"
        >
          <motion.div
            animate={{
              rotate: 360,
              scale: [1, 1.05, 1],
            }}
            transition={{
              rotate: { duration: 20, repeat: Infinity, ease: "linear" },
              scale: { duration: 4, repeat: Infinity, ease: "easeInOut" },
            }}
            className="absolute inset-0 w-[120%] h-[120%] -left-[10%] -top-[10%] bg-gradient-to-tr from-blue-100 to-purple-100 rounded-full blur-3xl opacity-40 z-0"
          ></motion.div>

          <div className="relative z-10 w-full max-w-[500px] aspect-square rounded-[3rem] overflow-hidden bg-white/40 backdrop-blur-md border border-white/60 shadow-2xl flex items-center justify-center p-8">
            <iframe
              src="https://lottie.host/embed/bf789b38-9f2e-4c82-9936-6e67d10a2051/ojS56QUEA0.lottie"
              className="w-full h-full border-none mix-blend-multiply"
              style={{ pointerEvents: "none" }}
              title="404 Animation"
            ></iframe>
          </div>

          <motion.div
            animate={{ y: [0, -15, 0] }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 0.8,
            }}
            className="absolute -top-10 -right-4 z-20 bg-white/90 backdrop-blur-sm p-4 rounded-2xl shadow-xl border border-gray-100 shadow-indigo-100/50"
          >
            <div className="flex gap-3 items-center">
              <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-lg">
                A+
              </div>
              <div>
                <div className="text-sm font-bold text-gray-800">学分 +0</div>
                <div className="text-xs text-gray-500">迷路也是种锻炼</div>
              </div>
            </div>
          </motion.div>

          <motion.div
            animate={{ y: [0, 20, 0] }}
            transition={{
              duration: 5,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 1.2,
            }}
            className="absolute -bottom-8 -left-8 z-20 bg-white/90 backdrop-blur-sm p-4 rounded-2xl shadow-xl border border-gray-100 shadow-purple-100/50"
          >
            <div className="flex gap-3 items-center">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center text-green-600">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <path d="M22 4 12 14.01l-3-3"></path>
                </svg>
              </div>
              <div>
                <div className="text-sm font-bold text-gray-800">虚惊一场</div>
                <div className="text-xs text-gray-500">快回主航道吧</div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
