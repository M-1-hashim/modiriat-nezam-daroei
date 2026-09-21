"use client";

/** دیالوگ فرم و دیالوگ تأیید */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  submitLabel = "ذخیره",
  submitting,
  wide,
  footerExtra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  onSubmit?: () => void;
  submitLabel?: string;
  submitting?: boolean;
  wide?: boolean;
  footerExtra?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`max-h-[90vh] overflow-y-auto ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="py-2">{children}</div>
        {onSubmit && (
          <DialogFooter className="gap-2">
            {footerExtra}
            <Button variant="outline" onClick={() => onOpenChange(false)} type="button">
              لغو
            </Button>
            <Button onClick={onSubmit} disabled={submitting} type="button">
              {submitting && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = "تأیید",
  danger,
  onConfirm,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  submitting?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel>لغو</AlertDialogCancel>
          <AlertDialogAction
            className={danger ? "bg-rose-600 text-white hover:bg-rose-700" : ""}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={submitting}
          >
            {submitting && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
