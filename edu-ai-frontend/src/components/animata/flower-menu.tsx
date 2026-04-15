import { useState, useId } from "react";

type MenuItem = {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  onClick?: () => void;
};

type FlowerMenuProps = {
  menuItems: MenuItem[];
  iconColor?: string;
  backgroundColor?: string;
  animationDuration?: number;
  togglerSize?: number;
};

const MenuToggler = ({
  isOpen,
  onChange,
  backgroundColor,
  iconColor,
  animationDuration,
  togglerSize,
  iconSize,
  menuId,
}: {
  isOpen: boolean;
  onChange: () => void;
  backgroundColor: string;
  iconColor: string;
  animationDuration: number;
  togglerSize: number;
  iconSize: number;
  menuId: string;
}) => {
  const lineHeight = iconSize * 0.1;
  const lineWidth = iconSize * 0.8;
  const lineSpacing = iconSize * 0.25;

  return (
    <>
      <input
        id={`menu-toggler-${menuId}`}
        type="checkbox"
        checked={isOpen}
        onChange={onChange}
        className="absolute inset-0 z-10 m-auto cursor-pointer opacity-0"
        style={{ width: togglerSize, height: togglerSize }}
      />
      <label
        htmlFor={`menu-toggler-${menuId}`}
        className="absolute inset-0 z-20 m-auto flex cursor-pointer items-center justify-center rounded-full transition"
        style={{
          backgroundColor,
          color: iconColor,
          transitionDuration: `${animationDuration}ms`,
          width: togglerSize,
          height: togglerSize,
        }}
      >
        <span
          className="relative flex flex-col items-center justify-center"
          style={{ width: iconSize, height: iconSize }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`absolute bg-current transition ${
                isOpen && i === 0
                  ? "opacity-0"
                  : isOpen
                    ? `${i === 1 ? "rotate-45" : "-rotate-45"}`
                    : ""
              }`}
              style={{
                transitionDuration: `${animationDuration}ms`,
                width: lineWidth,
                height: lineHeight,
                top: isOpen
                  ? `calc(50% - ${lineHeight / 2}px)`
                  : `calc(50% + ${(i - 1) * lineSpacing}px - ${lineHeight / 2}px)`,
              }}
            />
          ))}
        </span>
      </label>
    </>
  );
};

const MenuItem = ({
  item,
  index,
  isOpen,
  iconColor,
  backgroundColor,
  animationDuration,
  itemCount,
  itemSize,
  iconSize,
}: {
  item: MenuItem;
  index: number;
  isOpen: boolean;
  iconColor: string;
  backgroundColor: string;
  animationDuration: number;
  itemCount: number;
  itemSize: number;
  iconSize: number;
}) => {
  const Icon = item.icon;
  return (
    <li
      className={`absolute inset-0 m-auto transition ${isOpen ? "opacity-100" : "opacity-0"}`}
      style={{
        width: itemSize,
        height: itemSize,
        transform: isOpen
          ? `rotate(${(360 / itemCount) * index}deg) translateX(-${itemSize + 30}px)`
          : "none",
        transitionDuration: `${animationDuration}ms`,
      }}
    >
      <button
        onClick={item.onClick}
        type="button"
        className={`flex h-full w-full items-center justify-center rounded-full opacity-60 transition duration-100 ${
          isOpen ? "pointer-events-auto" : "pointer-events-none"
        } group hover:scale-125 hover:opacity-100`}
        style={{
          backgroundColor,
          color: iconColor,
          transform: `rotate(-${(360 / itemCount) * index}deg)`,
          transitionDuration: `${animationDuration}ms`,
        }}
      >
        <Icon
          className="transition-transform duration-200 group-hover:scale-125"
          style={{ width: iconSize, height: iconSize }}
        />
      </button>
    </li>
  );
};

export default function FlowerMenu({
  menuItems,
  iconColor = "white",
  backgroundColor = "rgba(255, 255, 255, 0.2)",
  animationDuration = 500,
  togglerSize = 40,
}: FlowerMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const elementId = useId();
  const itemCount = menuItems.length;
  const itemSize = togglerSize * 1.3; // significantly smaller
  const iconSize = Math.max(14, Math.floor(togglerSize * 0.45)); // smaller inner icons

  return (
    <nav className="relative flex items-center justify-center pointer-events-auto" style={{ width: itemSize * 2.5, height: itemSize * 2.5 }}>
      <MenuToggler
        isOpen={isOpen}
        onChange={() => setIsOpen(!isOpen)}
        backgroundColor={backgroundColor}
        iconColor={iconColor}
        animationDuration={animationDuration}
        togglerSize={togglerSize}
        iconSize={iconSize}
        menuId={elementId}
      />
      <ul className="absolute inset-0 m-0 h-full w-full list-none p-0">
        {menuItems.map((item, index) => (
          <MenuItem
            key={index}
            item={item}
            index={index}
            isOpen={isOpen}
            iconColor={iconColor}
            backgroundColor={backgroundColor}
            animationDuration={animationDuration}
            itemCount={itemCount}
            itemSize={itemSize}
            iconSize={iconSize}
          />
        ))}
      </ul>
    </nav>
  );
}
