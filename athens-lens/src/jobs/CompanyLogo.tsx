import { useState } from "react";

interface CompanyLogoProps {
  company: string;
  logoUrl: string;
  size: "list" | "detail";
}

export function CompanyLogo({ company, logoUrl, size }: CompanyLogoProps) {
  const [failedUrl, setFailedUrl] = useState("");

  return (
    <span className={`company-logo company-logo--${size}`} aria-hidden="true">
      {logoUrl && failedUrl !== logoUrl ? (
        <img src={logoUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(logoUrl)} />
      ) : (
        <span>{company.trim().charAt(0).toUpperCase() || "?"}</span>
      )}
    </span>
  );
}
