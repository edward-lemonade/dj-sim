import * as React from 'react';
import { cn } from 'cn';

export type DrawerSide = 'right' | 'bottom';

export type DrawerProps = React.HTMLAttributes<HTMLDivElement> & {
  side?: DrawerSide;
  open?: boolean;
};

export const Drawer = React.forwardRef<HTMLDivElement, DrawerProps>(
  ({ side = 'right', open = true, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-side={side}
        data-open={open}
        className={cn('drawer-root', side === 'bottom' ? 'drawer-bottom' : 'drawer-side', open ? 'is-open' : 'is-collapsed', className)}
        {...props}
      />
    );
  },
);
Drawer.displayName = 'Drawer';

export const DrawerHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('drawer-header', className)} {...props} />
  ),
);
DrawerHeader.displayName = 'DrawerHeader';

export const DrawerContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('drawer-content', className)} {...props} />
  ),
);
DrawerContent.displayName = 'DrawerContent';
